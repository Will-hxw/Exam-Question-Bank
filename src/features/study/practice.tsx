'use client'

import { type FormEvent, useEffect, useRef, useState } from 'react'
import { answerLetters, cachedPublic, letter, type Question, type QuestionPage, questionUrl, readPublic, type StudyStats } from './api'
import { ExplanationPanel, LoadMessage, TopicPicker } from './controls'
import { useQuestionStates, useStudySessionContext } from './study-shell'
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
type PracticeSettings = { mode: Mode; topic: string; position: number }
const defaultSettings: PracticeSettings = { mode: 'topic', topic: '', position: 0 }
const batchSize = 15

function readSettings(key: string): PracticeSettings {
  try {
    const text = sessionStorage.getItem(key)
    if (text) {
      const settings = JSON.parse(text) as PracticeSettings
      if (modes.some(({ id }) => id === settings.mode) && typeof settings.topic === 'string' && Number.isSafeInteger(settings.position) && settings.position >= 0) return settings
    }
  } catch { /* Use the default exercise entry. */ }
  return defaultSettings
}

function batchFor(index: number) {
  return { offset: Math.floor(index / batchSize) * batchSize, limit: batchSize }
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
    <span>已练习: {data?.attempted ?? '—'} 题 | 错题: {data?.wrong ?? '—'} | 收藏: {data?.favorites ?? '—'}</span>
    <span className="study-sync" role="status">{readout[attempts.status]}
      {attempts.status === 'error' && <button type="button" className="btn btn-sm" onClick={() => void attempts.flush()}>重试同步</button>}
      {stats.error && <button type="button" className="btn btn-sm" onClick={stats.retry}>重试统计</button>}
    </span>
  </div>
}

function PracticeCard({ question, answer, record, progress, previous, next, attempted, favorite, wrongMode }: {
  question: Question
  answer: Answer | undefined
  record: (answer: Answer) => void
  progress: React.ReactNode
  previous: (() => void) | null
  next: () => void
  attempted: boolean
  favorite: boolean | undefined
  wrongMode: boolean
}) {
  const { attempts, setFavorite, removeWrong, prefetchQuestionStates } = useStudySessionContext()
  const [selection, setSelection] = useState<string[]>([])
  const [expanded, setExpanded] = useState(false)
  const [message, setMessage] = useState('')
  const [savingFavorite, setSavingFavorite] = useState(false)
  const [favoriteOverride, setFavoriteOverride] = useState<boolean>()
  const [removing, setRemoving] = useState(false)
  const submittedAnswer = useRef(answer)
  const selected = answer?.ids ?? selection
  const currentFavorite = favoriteOverride ?? favorite
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
    if (immediate && !correct && question.explanation) setExpanded(true)
  }

  async function toggleFavorite() {
    if (savingFavorite) return
    if (!navigator.onLine) { setMessage('离线时无法更新收藏，请联网后重试。'); return }
    setMessage('')
    setSavingFavorite(true)
    try {
      let existingFavorite = currentFavorite
      if (existingFavorite === undefined) {
        const { states } = await prefetchQuestionStates([question.id])
        existingFavorite = states[question.id]?.isFavorite
        if (existingFavorite === undefined) throw new Error('暂时无法读取收藏状态，请重试。')
      }
      await setFavorite(question.id, !existingFavorite)
      setFavoriteOverride(!existingFavorite)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '收藏未保存，请重试。')
    } finally {
      setSavingFavorite(false)
    }
  }

  async function clearWrong() {
    setRemoving(true)
    try {
      await removeWrong(question.id)
      next()
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
        <button type="button" className="btn" disabled={!previous} onClick={previous ?? undefined}>上一题</button>
        <button type="button" className="btn" onClick={next}>下一题</button>
        <button type="button" className="btn btn-sm" aria-pressed={currentFavorite}
          aria-disabled={savingFavorite || undefined} onClick={() => void toggleFavorite()}>
          {currentFavorite === undefined ? '收藏' : currentFavorite ? '★ 取消收藏' : '☆ 收藏'}
        </button>
        {wrongMode && <button type="button" className="btn btn-sm" disabled={removing} onClick={() => void clearWrong()}>移出错题集</button>}
        <button type="button" className="btn btn-sm" aria-expanded={expanded} onClick={() => {
          if (wrongMode && !answer) { setMessage('请先作答本题'); return }
          if (!explanation) { setMessage('本题解析暂不可用'); return }
          if (answer?.saved !== false) setMessage('')
          setExpanded((previous) => !previous)
        }}>{expanded ? '收起解析' : '展开解析'}</button>
      </div>
      {savingFavorite && <p className="study-message" role="status">正在更新收藏…</p>}
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

function PracticeDeck({ mode, topic, topicCount, initialPosition, rememberPosition }: {
  mode: Mode; topic: string; topicCount: number; initialPosition: number; rememberPosition: (position: number) => void
}) {
  const { prefetchQuestionStates } = useStudySessionContext()
  const [position, setPosition] = useState(initialPosition)
  const [round, setRound] = useState(0)
  const [answers, setAnswers] = useState<Record<string, Answer>>({})
  const random = mode === 'random'
  const ordered = mode === 'topic' || mode === 'sequence'
  const status = mode === 'wrong' || mode === 'favorite' ? mode : ''
  const { offset, limit } = batchFor(position)
  const query = questionUrl({ topic, offset: random ? undefined : offset, limit, practice: true, status, random })
  const page = useStudyData<QuestionPage>(query, ordered ? 0 : round)
  const visiblePage = page.data ?? (ordered && page.loading ? cachedPublic<QuestionPage>(query) : undefined)
  const question = visiblePage?.questions[random ? position : position - offset]
  const total = (random ? visiblePage?.questions.length : visiblePage?.total) ?? topicCount
  const questionId = question?.id
  const states = useQuestionStates(status ? [] : visiblePage?.questions.map(({ id }) => id) ?? [])
  const activeState = questionId ? states.data?.states[questionId] : null
  const canPrefetch = ordered && Boolean(visiblePage?.nextCursor)

  useEffect(() => {
    if (!canPrefetch) return
    const next = batchFor(offset + limit)
    let active = true
    void readPublic<QuestionPage>(questionUrl({ topic, ...next, practice: true })).then(({ questions }) => {
      if (active && navigator.onLine && questions.length) {
        return prefetchQuestionStates(questions.map(({ id }) => id))
      }
    }).catch(() => {})
    return () => { active = false }
  }, [canPrefetch, topic, offset, limit, prefetchQuestionStates])

  function move(index: number) {
    setPosition(index)
    if (ordered) rememberPosition(index)
  }

  function next() {
    if (position + 1 < total) move(position + 1)
    else {
      move(0)
      setRound((previous) => previous + 1)
      setAnswers({})
    }
  }

  if (!question) return <>
    <LoadMessage loading={page.loading} error={page.error} retry={page.retry}
      empty={mode === 'wrong' ? '暂无错题' : mode === 'favorite' ? '暂无收藏题目' : '这个范围暂无已发布题目'} />
    {position > 0 && <div className="study-pagination"><button type="button" className="btn" onClick={() => move(0)}>回到第一题</button></div>}
  </>

  const cardKey = `${round}:${position}:${question.id}:${question.contentRevision ?? ''}`
  const fallback = mode === 'wrong' ? `错题模式 · 剩余 ${total} 题` : mode === 'favorite' ? `收藏模式 · 共 ${total} 题` : '随机'
  return <>
    <PracticeCard key={cardKey} question={question} answer={answers[cardKey]}
      record={(answer) => setAnswers((previous) => ({ ...previous, [cardKey]: answer }))}
      progress={<Progress mode={mode} index={position} total={total} fallback={fallback} onJump={move} />}
      previous={position > 0 ? () => move(position - 1) : null} next={next}
      attempted={activeState?.attempted ?? Boolean(question.attempted)}
      favorite={activeState?.isFavorite ?? question.isFavorite} wrongMode={mode === 'wrong'} />
    {states.error && !status && <p className="study-message error" role="alert">个人状态加载失败。 <button type="button" className="btn btn-sm" onClick={states.retry}>重试</button></p>}
  </>
}

export function Practice() {
  const { stats, topics, userId } = useStudySessionContext()
  const key = `cqu-study-practice:${userId}`
  const [settings, setSettings] = useState<PracticeSettings | null>(null)
  useEffect(() => {
    const initial = setTimeout(() => setSettings(readSettings(key)), 0)
    return () => clearTimeout(initial)
  }, [key])

  const { mode, topic: chosenTopic, position } = settings ?? defaultSettings
  const entries = topics.data?.topics ?? []
  const topic = mode === 'topic' ? entries.find((entry) => entry.id === chosenTopic) ?? entries.find((entry) => entry.count > 0) ?? entries[0] : undefined
  const topicCount = topic?.count ?? entries.reduce((sum, entry) => sum + entry.count, 0)
  const start = mode === 'sequence' || (mode === 'topic' && topic?.id === chosenTopic && position < topicCount) ? position : 0

  function saveSettings(next: PracticeSettings) {
    setSettings(next)
    try { sessionStorage.setItem(key, JSON.stringify(next)) } catch { /* The current page keeps the selected position. */ }
  }

  return <>
    <PracticeStats data={stats.data} />
    <div className="mode-bar" role="group" aria-label="练习模式">
      <span className="mode-label">模式：</span>
      {modes.map((entry) => <button key={entry.id} type="button" className={`mode-btn ${mode === entry.id ? 'active' : ''}`}
        aria-pressed={mode === entry.id} onClick={() => { if (mode !== entry.id) saveSettings({ mode: entry.id, topic: chosenTopic, position: 0 }) }}>{entry.label}</button>)}
    </div>
    {mode === 'topic' && topic && <div className="mode-bar">
      <span className="mode-label">专题：</span>
      <TopicPicker topics={entries} value={topic.id} onChange={(value) => saveSettings({ mode, topic: value, position: 0 })} />
    </div>}
    {!settings || mode === 'topic' && !topic ? <LoadMessage error={topics.error} loading={!settings || topics.loading} retry={topics.retry} empty="暂无已发布专题" /> : (
      <PracticeDeck key={`${mode}:${topic?.id || ''}`} mode={mode} topic={topic?.id ?? ''} topicCount={topicCount} initialPosition={start}
        rememberPosition={(next) => saveSettings({ mode, topic: topic?.id ?? chosenTopic, position: next })} />
    )}
  </>
}
