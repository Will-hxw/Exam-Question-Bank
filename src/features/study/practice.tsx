'use client'

import { Fragment, type FormEvent, useEffect, useRef, useState } from 'react'
import { answerLetters, letter, type Question, type QuestionPage, questionUrl, readPublic, type StudyStats } from './api'
import { ExplanationPanel, LoadMessage, TopicPicker } from './controls'
import type { StudyPreferences } from './preferences'
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
type Answer = { ids: string[]; correct: boolean; saved: boolean }
type PracticeSettings = { mode: Mode; topic: string; seed: string }
const batchSize = 15

function readSettings(value: unknown, initialSeed: string): PracticeSettings {
  const saved = value as Partial<PracticeSettings> | undefined
  const mode = modes.find(({ id }) => id === saved?.mode)?.id ?? 'topic'
  const topic = typeof saved?.topic === 'string' ? saved.topic : ''
  const seed = typeof saved?.seed === 'string' && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(saved.seed) ? saved.seed.toLowerCase() : initialSeed
  return { mode, topic, seed }
}

function positionKey(mode: Mode, topic: string) {
  return mode === 'topic' ? `topic:${topic}` : mode
}

function positionPreference(mode: Mode, topic: string, onlyUndone: boolean) {
  return `practice-position:${mode === 'random' && onlyUndone ? 'random-undone' : positionKey(mode, topic)}`
}

function practicePosition(values: StudyPreferences, mode: Mode, topic: string, onlyUndone = false) {
  const value = values[positionPreference(mode, topic, onlyUndone)]
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

function practicePagePath(mode: Mode, topic: string, position: number, seed: string, onlyUndone = false) {
  const { offset, limit } = batchFor(position)
  const random = mode === 'random' && !onlyUndone
  return questionUrl({
    topic: mode === 'topic' ? topic : undefined,
    offset: random ? undefined : offset,
    limit,
    practice: true,
    status: mode === 'wrong' || mode === 'favorite' ? mode : undefined,
    random: random ? seed : undefined,
    personal: onlyUndone,
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
    if (submittedAnswer.current?.saved) return
    const saved = attempts.enqueue(question.id, ids, question.contentRevision)
    const result = { ids, correct, saved }
    submittedAnswer.current = result
    record(result)
    setMessage(saved ? '' : '本次作答未能保存在本机。请重试保存。')
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
          if (answer?.saved !== false) setMessage('')
          setExpanded((previous) => !previous)
        }}>{expanded ? '收起解析' : '展开解析'}</button>
      </div>
      {favoriteControl.error && <p className="study-message error" role="alert">{favoriteControl.error}</p>}
      {!answer && expanded && explanation && <p className="answer-reveal">正确答案：<span>{answerLetters(explanation.options, explanation.answerIds)}</span></p>}
      {answer && <div role="status">
        <p className={`feedback ${answer.correct ? 'correct' : 'wrong'}`}>{answer.correct ? '✓ 正确' : '✗ 错误'}</p>
        <p className="answer-reveal">正确答案：<span>{answerLetters(question.options, question.answerIds ?? [])}</span> | 你的选择：<span>{answerLetters(question.options, answer.ids)}</span></p>
        {!answer.saved && <button type="button" className="btn btn-sm" onClick={() => saveAnswer(answer.ids, answer.correct)}>重试保存本题</button>}
      </div>}
      {message && <p className="study-message error" role="alert">{message}</p>}
    </article>
    {expanded && explanation && <ExplanationPanel content={explanation} onClose={() => setExpanded(false)} />}
  </>
}

function PracticeDeck({ mode, topic, topicCount, seed, start, rememberPosition, remaining }: {
  mode: Mode; topic: string; topicCount: number; seed: string; start: number | null
  rememberPosition: (position: number, seed?: string) => void
  remaining?: PracticePosition[]
}) {
  const { attempts, personalReads, prefetchQuestionStates, revision } = useStudySessionContext()
  const onlyUndone = remaining !== undefined
  const undoneSeed = onlyUndone && mode === 'random' ? seed : undefined
  const [filteredPosition, setFilteredPosition] = useState(() => {
    if (!remaining) return null
    const attempted = attempts.recentlyAttemptedIds()
    return initialUndonePosition(remaining.filter(({ id }) => !attempted.has(id)), start, undoneSeed)
  })
  const position = onlyUndone ? filteredPosition : start
  const index = position ?? 0
  const [round, setRound] = useState(0)
  const [answers, setAnswers] = useState<Record<string, Answer>>({})
  const [navigationMessage, setNavigationMessage] = useState('')
  const random = mode === 'random' && !onlyUndone
  const ordered = mode === 'topic' || mode === 'sequence'
  const status = mode === 'wrong' || mode === 'favorite' ? mode : ''
  const personal = Boolean(status) || onlyUndone
  const { offset, limit } = batchFor(index)
  const query = position === null ? null : practicePagePath(mode, topic, index, seed, onlyUndone)
  const page = useStudyData<QuestionPage>(query, personal ? revision : 0,
    personal ? { ...personalReads, keepPreviousData: onlyUndone } : undefined)
  const visiblePage = page.data
  const question = visiblePage?.questions[random ? index : index - offset]
  const total = (random ? visiblePage?.questions.length : visiblePage?.total) ?? topicCount
  const questionId = question?.id
  const states = useQuestionStates(personal ? [] : visiblePage?.questions.map(({ id }) => id) ?? [])
  const activeState = questionId ? states.data?.states[questionId] : null
  const canPrefetch = (ordered || onlyUndone) && Boolean(visiblePage?.nextCursor)

  useEffect(() => {
    if (!canPrefetch) return
    const next = batchFor(offset + limit)
    if (onlyUndone) {
      if (navigator.onLine) void personalReads.load(questionUrl({ topic, ...next, practice: true, personal: true })).catch(() => {})
      return
    }
    let active = true
    void readPublic<QuestionPage>(questionUrl({ topic, ...next, practice: true })).then(({ questions }) => {
      if (active && navigator.onLine && questions.length) {
        return prefetchQuestionStates(questions.map(({ id }) => id))
      }
    }).catch(() => {})
    return () => { active = false }
  }, [canPrefetch, topic, offset, limit, onlyUndone, personalReads, prefetchQuestionStates])

  function move(nextPosition: number) {
    setNavigationMessage('')
    if (onlyUndone) setFilteredPosition(nextPosition)
    rememberPosition(nextPosition)
  }

  function navigate(direction: 'previous' | 'next') {
    if (remaining && question) {
      const attempted = attempts.recentlyAttemptedIds()
      const available = remaining.filter(({ id }) => !attempted.has(id))
      const target = stepUndonePosition(available, { position: index, id: question.id }, direction, undoneSeed)
      if (target !== null) move(target)
      else setNavigationMessage(direction === 'previous' ? '前面没有未做题。'
        : available.length ? '只剩当前这道未做题。' : '这个范围的题都做过了。')
      return
    }
    if (direction === 'previous') move(index - 1)
    else if (index + 1 < total) move(index + 1)
    else {
      rememberPosition(0, random ? crypto.randomUUID() : undefined)
      setRound((previous) => previous + 1)
      setAnswers({})
    }
  }

  if (!question) return <>
    {position === null && ordered && total > 0 && <div className="study-pagination">
      <Progress mode={mode} index={start ?? 0} total={total} fallback="" onJump={move} />
    </div>}
    <LoadMessage loading={page.loading} error={page.error} retry={page.retry}
      empty={position === null ? '这个范围没有未做题。' : mode === 'wrong' ? '暂无错题' : mode === 'favorite' ? '暂无收藏题目' : '这个范围暂无已发布题目'} />
    {index > 0 && <div className="study-pagination"><button type="button" className="btn" onClick={() => move(0)}>回到第一题</button></div>}
  </>

  const cardKey = `${round}:${index}:${question.id}:${question.contentRevision ?? ''}`
  const fallback = mode === 'wrong' ? `错题模式 · 剩余 ${total} 题` : mode === 'favorite' ? `收藏模式 · 共 ${total} 题` : '随机'
  return <>
    <PracticeCard key={cardKey} question={question} answer={answers[cardKey]}
      record={(answer) => setAnswers((previous) => ({ ...previous, [cardKey]: answer }))}
      progress={<Progress mode={mode} index={index} total={total} fallback={fallback} onJump={move} />}
      previous={index > 0 || undoneSeed ? () => navigate('previous') : null} next={() => navigate('next')}
      attempted={activeState?.attempted ?? Boolean(question.attempted)}
      favorite={activeState?.isFavorite ?? question.isFavorite} wrongMode={mode === 'wrong'}
      onRemoved={() => rememberPosition(Math.min(index, Math.max(0, total - 2)))} />
    {navigationMessage && <p className="study-message" role="status">{navigationMessage}</p>}
    {states.error && !personal && <p className="study-message error" role="alert">个人状态加载失败。 <button type="button" className="btn btn-sm" onClick={states.retry}>重试</button></p>}
  </>
}

function PracticeContent() {
  const { stats, topics, preferences, personalReads } = useStudySessionContext()
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
  const position = practicePosition(preferences.values, mode, topicId, filtering)
  const pastEnd = (mode === 'topic' || mode === 'sequence') && topicCount > 0 && (position ?? 0) >= topicCount
  const boundedPosition = pastEnd ? 0 : position ?? 0
  const start = filtering && mode === 'random' ? position : boundedPosition
  const range = mode === 'topic' ? topicId : ''
  const remaining = useStudyData<{ positions: PracticePosition[] }>(
    filtering && (mode !== 'topic' || topicId) ? undonePath(range) : null, 0, personalReads,
  )

  function saveSettings(next: PracticeSettings) {
    preferences.save({ practice: next })
  }

  function warmPath(next: Mode) {
    if (onlyUndone && supportsUndone(next)) return undonePath(next === 'topic' ? topicId : '')
    return practicePagePath(next, topicId, practicePosition(preferences.values, next, topicId) ?? 0, seed)
  }

  function warmMode(next: Mode) {
    if (!navigator.onLine) return
    const path = warmPath(next)
    void (path.startsWith('/api/me/') ? personalReads.load(path) : readPublic(path)).catch(() => {})
  }

  const warmPaths = topicId ? modes.filter(({ id }) => id !== mode)
    .map(({ id }) => warmPath(id)).join('\n') : ''
  useEffect(() => {
    if (!warmPaths) return
    const timers = warmPaths.split('\n').map((path, index) => setTimeout(() => {
      if (!navigator.onLine || document.visibilityState !== 'visible') return
      void (path.startsWith('/api/me/') ? personalReads.load(path) : readPublic(path)).catch(() => {})
    }, 350 + index * 160))
    return () => timers.forEach(clearTimeout)
  }, [personalReads, warmPaths])

  return <>
    <PracticeStats data={stats.data} />
    <div className="mode-bar practice-mode-bar" role="group" aria-label="练习模式">
      <span className="mode-label">模式：</span>
      {modes.map((entry) => <Fragment key={entry.id}>
        <button type="button" className={`mode-btn ${mode === entry.id ? 'active' : ''}`}
          aria-pressed={mode === entry.id} onPointerEnter={() => warmMode(entry.id)} onFocus={() => warmMode(entry.id)}
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
      : <PracticeDeck key={positionPreference(mode, topicId, filtering) + (filtering ? ':filtered' : '')}
        mode={mode} topic={range} topicCount={topicCount} seed={seed} start={start} remaining={filtering ? remaining.data?.positions : undefined}
        rememberPosition={(next, nextSeed = seed) => preferences.save({
          [positionPreference(mode, topicId, filtering)]: next,
          ...((nextSeed !== seed || !preferences.values.practice) ? { practice: { ...settings, seed: nextSeed } } : {}),
        })} />}
  </>
}

export function Practice() {
  const { preferences } = useStudySessionContext()
  return preferences.ready ? <PracticeContent /> : <LoadMessage loading />
}
