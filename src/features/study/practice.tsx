'use client'

import { Fragment, type FormEvent, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import { answerLetters, letter, type Question, type QuestionPage, questionUrl, readPublic, requestJson, type StudyStats } from './api'
import { ExplanationPanel, LoadMessage, TopicPicker } from './controls'
import { readStudyPreference, type StudyPreferences, writeStudyPreference } from './preferences'
import { addPracticeBookmark, findPracticeBookmark, identifyPracticeBookmark, practiceHistoryLimit, restorePracticeHistory,
  sameBookmark, type PracticeBookmark, type PracticeDirection } from './practice-history'
import { initialUndonePosition, practiceUndonePreference, stepUndonePosition, type PracticePosition } from './practice-undone'
import { useQuestionFavorite, useQuestionStates, useStudySessionContext } from './study-shell'
import { useStudyData } from './use-study-data'

const modes = [
  { id: 'topic', label: '专题' },
  { id: 'random', label: '随机' },
  { id: 'sequence', label: '顺序' },
  { id: 'wrong', label: '错题' },
  { id: 'favorite', label: '收藏' },
] as const

type Mode = typeof modes[number]['id']
type Answer = { ids: string[]; correct: boolean; eventId: string | null }
type PracticeSettings = { mode: Mode; topic: string; seed: string; randomOnBank?: boolean }
const batchSize = 15

function readSettings(value: unknown, initialSeed: string): PracticeSettings {
  const saved = value as Partial<PracticeSettings> | undefined
  const mode = modes.find(({ id }) => id === saved?.mode)?.id ?? 'topic'
  const topic = typeof saved?.topic === 'string' ? saved.topic : ''
  const seed = typeof saved?.seed === 'string' && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(saved.seed) ? saved.seed.toLowerCase() : initialSeed
  return { mode, topic, seed, ...(typeof saved?.randomOnBank === 'boolean' ? { randomOnBank: saved.randomOnBank } : {}) }
}

function positionKey(mode: Mode, topic: string) {
  return mode === 'topic' ? `topic:${topic}` : mode
}

function positionPreference(mode: Mode, topic: string, randomOnBank: boolean) {
  return `practice-position:${mode === 'random' && randomOnBank ? 'random-undone' : positionKey(mode, topic)}`
}

function practicePosition(values: StudyPreferences, mode: Mode, topic: string, randomOnBank = false) {
  const value = values[positionPreference(mode, topic, randomOnBank)]
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value < 100000 ? value : null
}

function supportsUndone(mode: Mode) {
  return mode === 'topic' || mode === 'random' || mode === 'sequence'
}

function undonePath(topic: string) {
  return `/api/me/practice-undone${topic ? '?' + new URLSearchParams({ topic }) : ''}`
}

function batchFor(index: number) {
  return { offset: Math.floor(index / batchSize) * batchSize, limit: batchSize }
}

function practicePagePath(mode: Mode, topic: string, { position, seed }: PracticeBookmark) {
  const { offset, limit } = batchFor(position)
  return questionUrl({
    topic: mode === 'topic' ? topic : undefined,
    offset: seed ? undefined : offset,
    limit,
    practice: true,
    status: mode === 'wrong' || mode === 'favorite' ? mode : undefined,
    random: seed,
  })
}

function Progress({ mode, index, total, fallback, onJump }: {
  mode: Mode
  index: number
  total: number
  fallback: string
  onJump: (value: number) => void
}) {
  const [jumping, setJumping] = useState(false)
  const [input, setInput] = useState(String(index + 1))

  function jump(event: FormEvent) {
    event.preventDefault()
    const n = Number(input)
    if (Number.isSafeInteger(n) && n >= 1 && n <= total) {
      onJump(n - 1)
      setJumping(false)
    }
  }

  if (mode !== 'topic' && mode !== 'sequence') return <span className="progress-info">{fallback}</span>
  return <div className="progress-info">
    {mode === 'topic' ? '专题' : '顺序'} · 第 {jumping ? (
      <form className="jump-form" onSubmit={jump}>
        <input type="number" inputMode="numeric" className="jump-input" aria-label="题号" value={input} min={1} max={total}
          onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') setJumping(false) }} required />
        <button type="submit" className="jump-go">前往</button>
      </form>
    ) : index + 1} / {total} 题{' '}
    {!jumping && <button type="button" className="jump-link" onClick={() => { setInput(String(index + 1)); setJumping(true) }}>跳转</button>}
  </div>
}

function PracticeStats({ data }: { data: StudyStats | null }) {
  const { attempts, stats } = useStudySessionContext()
  const readout = { pending: '本地已保存，待同步', synced: '云端已同步', error: '保存或同步失败', rejected: '部分作答无法保存，题目可能已更新。', idle: '' }
  return <div className="stats-bar">
    <ul className="practice-stats" aria-label="练习统计">
      <li>已练习 <strong>{data?.attempted ?? '—'} 题</strong></li>
      <li>错题 <strong>{data?.wrong ?? '—'}</strong></li>
      <li>收藏 <strong>{data?.favorites ?? '—'}</strong></li>
    </ul>
    <span className="study-sync" role="status">{readout[attempts.status]}
      {attempts.status === 'error' && <button type="button" className="btn btn-sm" onClick={() => void attempts.flush()}>重试同步</button>}
      {stats.error && <button type="button" className="btn btn-sm" onClick={stats.retry}>重试统计</button>}
    </span>
  </div>
}

function PracticeCard({ question, answer, record, progress, previous, next, attempted, favorite, wrongMode, onRemoved }: {
  question: Question
  answer: Answer | undefined
  record: (answer: Answer) => void
  progress: React.ReactNode
  previous: (() => void) | null
  next: () => void
  attempted: boolean
  favorite: boolean | undefined
  wrongMode: boolean
  onRemoved: () => void
}) {
  const { attempts, removeWrong } = useStudySessionContext()
  const favoriteControl = useQuestionFavorite(question.id, favorite)
  const [selection, setSelection] = useState<string[]>([])
  const [expanded, setExpanded] = useState(false)
  const [message, setMessage] = useState('')
  const [removing, setRemoving] = useState(false)
  const submittedAnswer = useRef(answer)
  const selected = answer?.ids ?? selection
  const immediate = question.type === 'single'

  function saveAnswer(ids: string[], correct: boolean) {
    if (submittedAnswer.current?.eventId) return
    const eventId = attempts.enqueue(question.id, ids, question.contentRevision)
    const result = { ids, correct, eventId }
    submittedAnswer.current = result
    record(result)
    setMessage(eventId ? '' : '本次作答未能保存在本机。请重试保存。')
  }

  function submit(ids = selection) {
    if (submittedAnswer.current) return
    if (!ids.length) { setMessage('请选择答案'); return }
    if (!question.answerIds?.length) { setMessage('答案暂不可用，请稍后重试。'); return }
    const correct = ids.length === question.answerIds.length && ids.every((id) => question.answerIds?.includes(id))
    saveAnswer(ids, correct)
    if (!correct && question.explanation) setExpanded(true)
  }

  async function clearWrong() {
    setRemoving(true)
    try {
      await removeWrong(question.id)
      onRemoved()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '更新错题失败，请重试。')
    } finally {
      setRemoving(false)
    }
  }

  const explanation = question.answerIds && question.explanation ? {
    answerIds: question.answerIds, explanation: question.explanation, options: question.options, sources: question.sources ?? [],
  } : null

  return <>
    <article className="question-card" aria-label="练习题目">
      <div className="q-header">
        <span className={`q-type ${question.type}`}>{question.type === 'single' ? '单选题' : '多选题'}</span>
        {(answer || attempted) && <span className="done-badge">✓ 已答</span>}
        {progress}
      </div>
      <p className="q-text">{question.stem}</p>
      <div className="options-list" role="group" aria-label="选择答案">
        {question.options.map((option, index) => {
          const chosen = selected.includes(option.id)
          const isCorrect = question.answerIds?.includes(option.id)
          const style = answer && isCorrect ? 'correct' : answer && chosen ? 'wrong' : chosen ? 'selected' : ''
          return <button key={option.id} type="button" className={`option ${style}`} aria-pressed={chosen} disabled={Boolean(answer)}
            onClick={() => {
              if (submittedAnswer.current) return
              if (immediate) {
                const ids = [option.id]
                setSelection(ids)
                submit(ids)
                return
              }
              setMessage('')
              setSelection((before) => before.includes(option.id) ? before.filter((id) => id !== option.id) : [...before, option.id])
            }}>{letter(index)}. {option.text}</button>
        })}
      </div>
      <div className="action-bar">
        <button type="button" className="btn primary" disabled={Boolean(answer)} onClick={() => submit()}>确定</button>
        <button type="button" className="btn nav-step" disabled={!previous} onClick={previous ?? undefined}>上一题</button>
        <button type="button" className="btn nav-step" onClick={next}>下一题</button>
        <button type="button" className="btn btn-sm" aria-pressed={favoriteControl.favorite}
          aria-busy={favoriteControl.pending || undefined} onClick={favoriteControl.toggle}>
          {favoriteControl.favorite ? '★ 取消收藏' : '☆ 收藏'}
        </button>
        {wrongMode && <button type="button" className="btn btn-sm" disabled={removing} onClick={() => void clearWrong()}>移出错题集</button>}
        <button type="button" className="btn btn-sm explanation-toggle" aria-expanded={expanded} onClick={() => {
          if (wrongMode && !answer) { setMessage('请先作答本题'); return }
          if (!explanation) { setMessage('本题解析暂不可用'); return }
          if (answer?.eventId !== null) setMessage('')
          setExpanded((previous) => !previous)
        }}>{expanded ? '收起解析' : '展开解析'}</button>
      </div>
      {favoriteControl.error && <p className="study-message error" role="alert">{favoriteControl.error}</p>}
      {!answer && expanded && explanation && <p className="answer-reveal">正确答案：<span>{answerLetters(explanation.options, explanation.answerIds)}</span></p>}
      {answer && <div role="status">
        <p className={`feedback ${answer.correct ? 'correct' : 'wrong'}`}>{answer.correct ? '✓ 正确' : '✗ 错误'}</p>
        <p className="answer-reveal">正确答案：<span>{answerLetters(question.options, question.answerIds ?? [])}</span> | 你的选择：<span>{answerLetters(question.options, answer.ids)}</span></p>
        {!answer.eventId && <button type="button" className="btn btn-sm" onClick={() => saveAnswer(answer.ids, answer.correct)}>重试保存本题</button>}
      </div>}
      {message && <p className="study-message error" role="alert">{message}</p>}
    </article>
    {expanded && explanation && <ExplanationPanel content={explanation} onClose={() => setExpanded(false)} />}
  </>
}

function eligibleBookmarks(positions?: PracticePosition[]) {
  if (!positions) return () => true
  const ids = new Set(positions.map(({ id }) => id))
  const order = new Set(positions.map(({ position }) => position))
  return (entry: PracticeBookmark) => entry.id ? ids.has(entry.id) : !entry.seed && order.has(entry.position)
}

function PracticeDeck({ mode, topic, topicCount, seed, start, rememberPosition, remaining }: {
  mode: Mode; topic: string; topicCount: number; seed: string; start: PracticeBookmark
  rememberPosition: (bookmark: PracticeBookmark) => void
  remaining?: PracticePosition[]
}) {
  const { userId, attempts, personalReads, prefetchQuestionStates, revision } = useStudySessionContext()
  const storageKey = `cqu-practice-history:${userId}:${positionKey(mode, topic)}`
  const onlyUndone = remaining !== undefined
  const undoneSeed = onlyUndone && mode === 'random' ? seed : undefined
  const attempted = attempts.recentlyAttemptedIds()
  const available = remaining?.filter(({ id }) => !attempted.has(id))
  const eligible = eligibleBookmarks(available)
  const [trail, setTrail] = useState(() => {
    const restored = restorePracticeHistory(readStudyPreference(storageKey), start)
    const active = restored.entries[restored.cursor]
    const history = { ...restored, filtered: onlyUndone, empty: false }
    if (available && !available.length) return { ...history, empty: true }
    if (!available || (restored.filtered && !restored.empty) || eligible(active)) return history
    const next = findPracticeBookmark(history, 'next', eligible)
    if (next >= 0) return { ...history, cursor: next }
    const position = initialUndonePosition(available, active.seed ? null : active.position, undoneSeed)
    return position === null ? { ...history, empty: true } : addPracticeBookmark(history, { position }, 'next')
  })
  const active = trail.entries[trail.cursor]
  const { position: requestedIndex } = active
  const [round, setRound] = useState(0)
  const [answers, setAnswers] = useState<Record<string, Answer>>({})
  const [navigationMessage, setNavigationMessage] = useState('')
  const refreshed = useRef(new Set<string>())
  const seededBatch = Boolean(active.seed)
  const ordered = mode === 'topic' || mode === 'sequence'
  const status = mode === 'wrong' || mode === 'favorite' ? mode : ''
  const personal = Boolean(status)
  const { offset } = batchFor(requestedIndex)
  const query = trail.empty ? null : practicePagePath(mode, topic, active)
  const page = useStudyData<QuestionPage>(query, personal ? revision : 0,
    personal ? personalReads : undefined)
  const visiblePage = page.data
  const total = (seededBatch ? visiblePage?.questions.length : visiblePage?.total) ?? topicCount
  const relocated = personal && active.id ? visiblePage?.questions.findIndex(({ id }) => id === active.id) ?? -1 : -1
  const index = relocated >= 0 ? offset + relocated
    : personal && visiblePage?.total !== undefined ? Math.min(requestedIndex, Math.max(0, total - 1)) : requestedIndex
  const question = visiblePage?.questions[seededBatch ? index : index - offset]
  const questionId = question?.id
  const cardKey = question ? `${round}:${active.seed ?? ''}:${index}:${question.id}:${question.contentRevision ?? ''}` : ''
  const answer = answers[cardKey]
  const rejected = answer?.eventId && attempts.rejections[answer.eventId] ? answer.eventId : undefined
  const lastRejection = Object.entries(attempts.rejections).findLast(([, id]) => id === questionId)?.[0] ?? ''
  const states = useQuestionStates(personal ? [] : visiblePage?.questions.map(({ id }) => id) ?? [])
  const activeState = questionId ? states.data?.states[questionId] : null
  const history = useMemo(() => questionId ? identifyPracticeBookmark(trail, questionId) : trail, [trail, questionId])
  const syncPosition = useEffectEvent((bookmark: PracticeBookmark) => {
    if (!sameBookmark(start, bookmark)) rememberPosition(bookmark)
  })

  useEffect(() => {
    writeStudyPreference(storageKey, history)
    if (!history.empty) syncPosition(history.entries[history.cursor])
  }, [history, storageKey])

  const reload = page.reload
  useEffect(() => {
    if (!rejected || refreshed.current.has(rejected)) return
    refreshed.current.add(rejected)
    reload((path) => requestJson<QuestionPage>(path.replace('/api/public/', '/api/me/'), { headers: { 'X-Study-Account': userId } }))
  }, [rejected, reload, userId])

  if (index !== requestedIndex) {
    setTrail({ ...trail, entries: trail.entries.map((entry, at) => at === trail.cursor ? { position: index, id: questionId } : entry) })
  }

  function findNeighbor(direction: PracticeDirection): PracticeBookmark | undefined {
    if (available && question) {
      const target = stepUndonePosition(available, { position: index, id: question.id }, direction, undoneSeed)
      return target === null ? undefined : { position: target, id: available.find(({ position }) => position === target)?.id }
    }
    if (mode === 'random' && !active.seed) return undefined
    const target = index + (direction === 'previous' ? -1 : 1)
    return target >= 0 && target < total ? { position: target, seed: active.seed } : undefined
  }

  const nextIndex = findPracticeBookmark(history, 'next', eligible)
  const previousIndex = findPracticeBookmark(history, 'previous', eligible)
  const ahead = nextIndex >= 0 ? history.entries[nextIndex] : findNeighbor('next')
  const behind = previousIndex >= 0 ? history.entries[previousIndex] : findNeighbor('previous')
  const warmPaths = question
    ? [...new Set([ahead, behind].flatMap((entry) => entry ? [practicePagePath(mode, topic, entry)] : []))]
      .filter((path) => path !== query).join('\n') : ''

  useEffect(() => {
    if (!warmPaths) return
    const timer = setTimeout(() => {
      if (!navigator.onLine || document.hidden) return
      for (const path of warmPaths.split('\n')) {
        if (personal) void personalReads.load(path).catch(() => {})
        else void readPublic<QuestionPage>(path).then(({ questions }) => {
          if (questions.length) return prefetchQuestionStates(questions.map(({ id }) => id))
        }).catch(() => {})
      }
    }, 150)
    return () => clearTimeout(timer)
  }, [personal, personalReads, prefetchQuestionStates, warmPaths])

  function move(next: typeof history) {
    setNavigationMessage('')
    setTrail(next)
    writeStudyPreference(storageKey, next)
    const bookmark = next.entries[next.cursor]
    if (!sameBookmark(start, bookmark)) rememberPosition(bookmark)
  }

  function jump(next: number) {
    move(addPracticeBookmark(history, { position: next, seed: active.seed }, 'jump'))
  }

  function navigate(direction: PracticeDirection) {
    const recorded = direction === 'previous' ? previousIndex : nextIndex
    if (recorded >= 0) {
      move({ ...history, cursor: recorded, empty: false })
      return
    }
    const target = direction === 'previous' ? behind : ahead
    if (target) {
      move(addPracticeBookmark(history, target, direction))
    } else if (available) {
      setNavigationMessage(direction === 'previous' ? '前面没有未做题。'
        : available.length ? '只剩当前这道未做题。' : '这个范围的题都做过了。')
    } else if (direction === 'next') {
      move(addPracticeBookmark(history, { position: 0, seed: mode === 'random' ? crypto.randomUUID() : undefined }, 'next'))
      setRound((previous) => previous + 1)
      setAnswers({})
    }
  }

  if (!question) return <>
    {trail.empty && ordered && total > 0 && <div className="study-pagination">
      <Progress mode={mode} index={index} total={total} fallback="" onJump={jump} />
    </div>}
    <LoadMessage loading={page.loading} error={page.error} retry={page.retry}
      empty={trail.empty ? '这个范围没有未做题。' : mode === 'wrong' ? '暂无错题' : mode === 'favorite' ? '暂无收藏题目' : '这个范围暂无已发布题目'} />
    {index > 0 && !trail.empty && <div className="study-pagination"><button type="button" className="btn" onClick={() => jump(0)}>回到第一题</button></div>}
  </>

  const fallback = mode === 'wrong' ? `错题模式 · 剩余 ${total} 题` : mode === 'favorite' ? `收藏模式 · 共 ${total} 题` : '随机'
  return <>
    <PracticeCard key={`${cardKey}:${lastRejection}`} question={question} answer={rejected ? undefined : answer}
      record={(answer) => setAnswers((previous) => Object.fromEntries([...Object.entries(previous).filter(([key]) => key !== cardKey),
        [cardKey, answer]].slice(-practiceHistoryLimit)))}
      progress={<Progress mode={mode} index={index} total={total} fallback={fallback} onJump={jump} />}
      previous={behind ? () => navigate('previous') : null} next={() => navigate('next')}
      attempted={Boolean(attempted.has(question.id) || (onlyUndone && !eligible({ ...active, id: question.id }))
        || (activeState?.attempted ?? question.attempted))}
      favorite={activeState?.isFavorite ?? question.isFavorite} wrongMode={mode === 'wrong'}
      onRemoved={() => jump(Math.min(index, Math.max(0, total - 2)))} />
    {navigationMessage && <p className="study-message" role="status">{navigationMessage}</p>}
    {rejected && <p className="study-message error" role="status">本题作答未保存，请按最新题目重新作答。</p>}
    {states.error && !personal && <p className="study-message error" role="alert">个人状态加载失败。 <button type="button" className="btn btn-sm" onClick={states.retry}>重试</button></p>}
  </>
}

function PracticeContent() {
  const { stats, topics, preferences, personalReads, revision } = useStudySessionContext()
  const [initialSeed] = useState(() => crypto.randomUUID())
  const settings = readSettings(preferences.values.practice, initialSeed)
  const { mode, topic: chosenTopic, seed } = settings
  const entries = topics.data?.topics ?? []
  const topic = entries.find((entry) => entry.id === chosenTopic) ?? entries.find((entry) => entry.count > 0) ?? entries[0]
  const topicId = topic?.id ?? ''
  const total = entries.reduce((sum, entry) => sum + entry.count, 0)
  const topicCount = mode === 'topic' ? topic?.count ?? 0 : total
  const onlyUndone = preferences.values[practiceUndonePreference] === true
  const filtering = onlyUndone && supportsUndone(mode)
  const randomOnBank = mode === 'random' && (settings.randomOnBank
    ?? (filtering && practicePosition(preferences.values, mode, topicId, true) !== null))
  const position = practicePosition(preferences.values, mode, topicId, randomOnBank)
  const pastEnd = (mode === 'topic' || mode === 'sequence') && topicCount > 0 && (position ?? 0) >= topicCount
  const boundedPosition = pastEnd ? 0 : position ?? 0
  const start: PracticeBookmark = mode === 'random' && !randomOnBank
    ? { position: Math.min(boundedPosition, batchSize - 1), seed } : { position: boundedPosition }
  const range = mode === 'topic' ? topicId : ''
  const remaining = useStudyData<{ positions: PracticePosition[] }>(
    filtering && (mode !== 'topic' || topicId) ? undonePath(range) : null, revision, { ...personalReads, keepPreviousData: true },
  )

  function saveSettings(next: PracticeSettings) {
    preferences.save({ practice: next })
  }

  function warmPath(next: Mode) {
    if (onlyUndone && supportsUndone(next)) return undonePath(next === 'topic' ? topicId : '')
    const onBank = next === 'random' && settings.randomOnBank === true
    return practicePagePath(next, topicId, {
      position: practicePosition(preferences.values, next, topicId, onBank) ?? 0,
      seed: next === 'random' && !onBank ? seed : undefined,
    })
  }

  function warmMode(next: Mode) {
    if (!navigator.onLine) return
    const path = warmPath(next)
    void (path.startsWith('/api/me/') ? personalReads.load(path) : readPublic(path)).catch(() => {})
  }

  function rememberPosition(bookmark: PracticeBookmark) {
    const nextSeed = bookmark.seed ?? seed
    const nextRandomOnBank = mode === 'random' ? !bookmark.seed : settings.randomOnBank
    const updateSettings = nextSeed !== seed || nextRandomOnBank !== settings.randomOnBank || !preferences.values.practice
    preferences.save({
      [positionPreference(mode, topicId, nextRandomOnBank === true)]: bookmark.position,
      ...(updateSettings ? { practice: { ...settings, seed: nextSeed, randomOnBank: nextRandomOnBank } } : {}),
    })
  }

  return <>
    <PracticeStats data={stats.data} />
    <div className="mode-bar practice-mode-bar" role="group" aria-label="练习模式">
      <span className="mode-label">模式：</span>
      {modes.map((entry) => <Fragment key={entry.id}>
        <button type="button" className={`mode-btn ${mode === entry.id ? 'active' : ''}`}
          aria-pressed={mode === entry.id} onPointerEnter={() => warmMode(entry.id)} onFocus={() => warmMode(entry.id)}
          onPointerDown={() => warmMode(entry.id)}
          onClick={() => { if (mode !== entry.id) saveSettings({ ...settings, mode: entry.id }) }}>{entry.label}</button>
        {entry.id === 'sequence' && <button type="button" className={`mode-btn practice-undone-btn ${onlyUndone ? 'active' : ''}`}
          aria-pressed={onlyUndone} onClick={() => preferences.save({ [practiceUndonePreference]: !onlyUndone })}>只刷未做</button>}
      </Fragment>)}
    </div>
    {mode === 'topic' && topic && <div className="mode-bar">
      <span className="mode-label">专题：</span>
      <TopicPicker topics={entries} value={topic.id} onChange={(value) => saveSettings({ ...settings, topic: value })} />
    </div>}
    {mode === 'topic' && !topic ? <LoadMessage error={topics.error} loading={topics.loading} retry={topics.retry} empty="暂无已发布专题" />
      : filtering && !remaining.data ? <LoadMessage error={remaining.error} loading={remaining.loading} retry={remaining.retry} />
      : <PracticeDeck key={positionKey(mode, topicId) + (filtering ? ':filtered' : '')}
        mode={mode} topic={range} topicCount={topicCount} seed={seed} start={start} remaining={filtering ? remaining.data?.positions : undefined}
        rememberPosition={rememberPosition} />}
  </>
}

export function Practice() {
  const { preferences } = useStudySessionContext()
  return preferences.ready ? <PracticeContent /> : <LoadMessage loading />
}
