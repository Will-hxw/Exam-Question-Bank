'use client'

import { useEffect, useRef, useState } from 'react'
import { answerLetters, letter, type Question, requestJson, StudyRequestError, writeJson } from './api'
import { ExplanationPanel, LoadMessage } from './controls'
import { type Exam as ExamData, useExamDraft } from './exam-draft'
import { DEFAULT_EXAM_QUESTIONS, isExamQuestionCount, MAX_EXAM_QUESTIONS, MIN_EXAM_QUESTIONS } from './exam-size'
import { useQuestionFavorite, useQuestionStates, useStudySessionContext } from './study-shell'
import { useStudyData } from './use-study-data'

type ExamSummary = Pick<ExamData, 'id' | 'status' | 'startedAt' | 'submittedAt' | 'score'> & { total?: number }
type ExamView = { screen: 'entrance' | 'history' | 'exam'; id: string | null; count: number; wrongOnly: boolean }

function readExamView(value: unknown): ExamView {
  const saved = value as Partial<ExamView> | undefined
  const id = typeof saved?.id === 'string' && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(saved.id) ? saved.id : null
  const screen = saved?.screen === 'history' ? 'history' : saved?.screen === 'exam' && id ? 'exam' : 'entrance'
  return { screen, id, count: isExamQuestionCount(saved?.count) ? saved.count : DEFAULT_EXAM_QUESTIONS, wrongOnly: saved?.wrongOnly === true }
}

function clock(seconds: number) {
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

function elapsedSeconds(exam: Pick<ExamData, 'startedAt' | 'submittedAt'>, now = Date.now()) {
  return Math.max(0, Math.floor(((exam.submittedAt ? Date.parse(exam.submittedAt) : now) - Date.parse(exam.startedAt)) / 1000))
}

function examDate(exam: ExamSummary) {
  return new Date(exam.submittedAt ?? exam.startedAt).toLocaleString('zh-CN', { hour12: false, timeZone: 'Asia/Singapore' })
}

function ExamTimer({ exam }: { exam: ExamData }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(interval)
  }, [])
  return <span className="exam-timer running">{clock(elapsedSeconds(exam, now))}</span>
}

function ExamFavorite({ question }: { question: Question }) {
  useQuestionStates([question.id])
  const favoriteControl = useQuestionFavorite(question.id)

  return <>
    <button className="btn btn-sm" type="button" aria-pressed={favoriteControl.favorite}
      aria-busy={favoriteControl.pending || undefined} onClick={favoriteControl.toggle}>
      {favoriteControl.favorite ? '★ 取消收藏' : '☆ 收藏'}
    </button>
    {favoriteControl.error && <p className="study-message error" role="alert">{favoriteControl.error}</p>}
  </>
}

function ExamTaking({ exam, onResult, onReload }: { exam: ExamData; onResult: (exam: ExamData) => void; onReload: (onLoaded?: () => void) => void }) {
  const { userId, markExamActive } = useStudySessionContext()
  const { draft, update, flush, submit, syncStatus, abandonLocalDraft } = useExamDraft(userId, exam)
  const [submitting, setSubmitting] = useState(false)
  const submittingNow = useRef(false)
  const [error, setError] = useState('')
  const autoAdvance = useRef<ReturnType<typeof setTimeout> | null>(null)
  const count = exam.items.length
  const position = Math.min(Math.max(draft.position, 0), count - 1)
  const item = exam.items[position]
  const done = Object.values(draft.answers).filter((choices) => choices.length > 0).length
  const selected = draft.answers[item?.id] ?? []
  const markers = { local: '草稿本地已保存，待同步', synced: '草稿已云端同步', pending: '草稿正在保存', error: '草稿同步失败', conflict: '云端草稿已在别处更新，本机未同步的修改仍保留。' }
  const blocked = submitting || syncStatus === 'conflict'

  useEffect(() => () => { if (autoAdvance.current) clearTimeout(autoAdvance.current) }, [])
  useEffect(() => {
    markExamActive(true)
    return () => markExamActive(false)
  }, [markExamActive])

  function move(index: number) {
    if (autoAdvance.current) clearTimeout(autoAdvance.current)
    if (index >= 0 && index < count) update({ position: index })
  }

  function choose(id: string) {
    if (autoAdvance.current) clearTimeout(autoAdvance.current)
    const answer = item.type === 'single' ? [id] : selected.includes(id) ? selected.filter((value) => value !== id) : [...selected, id]
    update({ answers: { ...draft.answers, [item.id]: answer } })
    if (item.type === 'single' && position + 1 < count) autoAdvance.current = setTimeout(() => move(position + 1), 180)
  }

  async function handIn() {
    if (blocked || submittingNow.current) return
    if (autoAdvance.current) clearTimeout(autoAdvance.current)
    const missing = count - done
    if (!window.confirm(missing ? `还有 ${missing} 道题未作答，确定交卷吗？` : '确定交卷吗？')) return
    setError('')
    submittingNow.current = true
    setSubmitting(true)
    try { onResult(await submit()) } catch (cause) {
      setError(cause instanceof StudyRequestError && cause.status === 409 ? '草稿已有更新，请核对云端草稿后再交卷。' : '交卷失败，请检查网络后重试。')
    } finally { submittingNow.current = false; setSubmitting(false) }
  }

  if (!item) return <LoadMessage error="试卷内容暂不可用。" retry={() => onReload()} />

  return <>
    <div className="exam-header">
      <div className="exam-header-left">
        <div className="exam-progress-row"><span className="exam-progress-label">答题进度</span><span className="exam-progress-count">{done}<span className="exam-progress-total">/{count}</span></span></div>
        <div className="exam-progress-bar" role="progressbar" aria-label="答题进度" aria-valuenow={done} aria-valuemin={0} aria-valuemax={count}>
          <div className="exam-progress-fill" style={{ width: `${done / count * 100}%` }} />
        </div>
      </div>
      <ExamTimer exam={exam} />
      <button type="button" className="btn btn-submit-exam" disabled={blocked} aria-busy={submitting || undefined} onClick={() => void handIn()}>{submitting ? '交卷中…' : '交卷'}</button>
    </div>
    <p className="study-message" role="status">{markers[syncStatus]}{' '}
      {syncStatus === 'error' && <button type="button" className="btn btn-sm" onClick={() => void flush().catch(() => {})}>重试同步</button>}
      {syncStatus === 'conflict' && <button type="button" className="btn btn-sm" onClick={() => {
        if (!window.confirm('改用云端草稿将放弃本机未同步的修改。确定继续吗？')) return
        onReload(abandonLocalDraft)
      }}>改用云端草稿</button>}
    </p>
    {error && <p className="study-message error" role="alert">{error}</p>}
    <article className="question-card exam-question-card" aria-label="当前考题">
      <div className="q-header"><span className={`q-type ${item.type}`}>{item.type === 'single' ? '单选题' : '多选题'}</span><span className="progress-info">第 {position + 1}/{count} 题</span></div>
      <p className="q-text">{item.stem}</p>
      <div className="options-list" role="group" aria-label="选择答案">
        {item.options.map((option, index) => <button key={option.id} type="button" className={`option ${selected.includes(option.id) ? 'selected' : ''}`}
          disabled={blocked} aria-pressed={selected.includes(option.id)} onClick={() => choose(option.id)}>{letter(index)}. {option.text}</button>)}
      </div>
      <div className="action-bar">
        <button type="button" className="btn nav-step" disabled={position === 0 || blocked} onClick={() => move(position - 1)}>上一题</button>
        {item.type === 'multiple' && <button type="button" className="btn primary nav-step" disabled={position === count - 1 || blocked} onClick={() => move(position + 1)}>确定</button>}
        <button type="button" className="btn nav-step" disabled={position === count - 1 || blocked} onClick={() => move(position + 1)}>下一题</button>
        <ExamFavorite key={item.id} question={item} />
        <button type="button" className="btn btn-sm exam-mark" disabled={blocked} aria-pressed={draft.marked.includes(item.id)} onClick={() => update({
          marked: draft.marked.includes(item.id) ? draft.marked.filter((id) => id !== item.id) : [...draft.marked, item.id],
        })}>
          <svg className="exam-mark-icon" aria-hidden="true" focusable="false" width="16" height="16" viewBox="0 0 16 16">
            <path d="M2.5 3a.5.5 0 0 1 .5-.5h4.5l5.8 5.8-5 5L2.5 7.5Z" fill="#fbbf24" stroke="#854d0e" strokeLinejoin="round" />
            <circle cx="5.2" cy="5.2" r=".9" fill="#854d0e" />
          </svg>
          {draft.marked.includes(item.id) ? '已标记' : '标记'}
        </button>
      </div>
    </article>
    <p className="exam-nav-label">题目导航</p>
    <div className="exam-nav" role="group" aria-label="题目导航">
      {exam.items.map((question, index) => <button type="button" key={question.id} disabled={blocked}
        className={`exam-nav-item${index === position ? ' current' : ''}${draft.answers[question.id]?.length ? ' answered' : ''}${draft.marked.includes(question.id) ? ' marked' : ''}`}
        aria-current={index === position ? 'step' : undefined} onClick={() => move(index)}>{index + 1}</button>)}
    </div>
  </>
}

function ResultItem({ exam, question, index }: { exam: ExamData; question: Question; index: number }) {
  const [expanded, setExpanded] = useState(false)
  const correct = Boolean(exam.correctness?.[question.id])
  const answerIds = question.answerIds ?? []
  const selected = exam.answers[question.id] ?? []

  return <article className={`exam-result-item ${correct ? 'result-correct' : 'result-wrong'}`}>
    <div className="exam-result-header">
      <span className={`q-num${correct ? ' result-correct' : ''}`}>{correct ? '✓' : '✗'}</span>
      <span className="exam-result-num">{index + 1}</span>
      <span className={`q-type ${question.type}`}>{question.type === 'single' ? '单选题' : '多选题'}</span>
    </div>
    <p className="exam-result-question">{question.stem}</p>
    <div className="exam-result-options">
      {question.options.map((option, i) => <button key={option.id} type="button" disabled
        className={`option ${answerIds.includes(option.id) ? 'correct' : selected.includes(option.id) ? 'wrong' : ''}`}>
        {letter(i)}. {option.text}
      </button>)}
    </div>
    {!correct && <div className="exam-wrong-answers">
      <p className="answer-row wrong-row">✗ 你的答案：{answerLetters(question.options, selected) || '未作答'}</p>
      <p className="answer-row correct-row">✓ 正确答案：{answerLetters(question.options, answerIds)}</p>
    </div>}
    {question.explanation && <button type="button" className="btn btn-sm explanation-toggle" onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>{expanded ? '收起解析' : '展开解析'}</button>}
    {expanded && question.explanation && <ExplanationPanel content={{ answerIds, explanation: question.explanation, options: question.options, sources: question.sources ?? [] }} />}
  </article>
}

function ExamResult({ exam, onBack, onRetry, wrongOnly, setWrongOnly, busy }: {
  exam: ExamData; onBack: () => void; onRetry: () => void; wrongOnly: boolean
  setWrongOnly: (value: boolean) => void; busy: boolean
}) {
  const score = exam.score ?? 0
  const count = exam.items.length
  const rate = count ? Math.round(score / count * 100) : 0
  const circumference = 326.73
  const replayButton = <button type="button" className="btn primary exam-result-replay" onClick={onRetry}
    disabled={busy} aria-busy={busy || undefined}>{busy ? '正在载入原卷…' : '原卷重新考试'}</button>

  return <div className="exam-result">
    <div className="exam-result-top">
      <button type="button" className="btn nav-step exam-result-back" onClick={onBack} disabled={busy}>← 返回</button>
      <h2>考试结果</h2>
      {replayButton}
    </div>
    <div className="exam-score-visual">
      <svg className="exam-score-ring" aria-hidden="true" viewBox="0 0 120 120">
        <circle className="ring-bg" cx="60" cy="60" r="52" />
        <circle className={`ring-fill ${rate >= 90 ? 'perfect' : rate >= 60 ? 'good' : 'fail'}`} cx="60" cy="60" r="52" strokeDasharray={circumference} strokeDashoffset={circumference * (1 - rate / 100)} />
      </svg>
      <div className="exam-score-inner"><span className={`exam-score-num ${rate < 60 ? 'fail-color' : ''}`}>{score}</span><span className="exam-score-total">/ {count}</span></div>
    </div>
    <div className="exam-stats-row">
      <div className="exam-stat-card"><span className="exam-stat-value">{rate}%</span><span className="exam-stat-label">正确率</span></div>
      <div className="exam-stat-card"><span className="exam-stat-value">{clock(elapsedSeconds(exam))}</span><span className="exam-stat-label">用时</span></div>
      <div className="exam-stat-card"><span className="exam-stat-value">{count - score}</span><span className="exam-stat-label">错题</span></div>
    </div>
    <div className="exam-result-filter">
      <button type="button" className={`filter-chip ${wrongOnly ? '' : 'active'}`} aria-pressed={!wrongOnly} onClick={() => setWrongOnly(false)}>全部 {count}</button>
      <button type="button" className={`filter-chip ${wrongOnly ? 'active' : ''}`} aria-pressed={wrongOnly} onClick={() => setWrongOnly(true)}>仅错题 {count - score}</button>
    </div>
    {exam.items.map((question, index) => (!wrongOnly || !exam.correctness?.[question.id]) ? <ResultItem key={question.id} exam={exam} question={question} index={index} /> : null)}
    <div className="exam-result-actions">
      {replayButton}
      <button type="button" className="btn nav-step" onClick={onBack} disabled={busy}>返回</button>
    </div>
  </div>
}

function ExamContent() {
  const { userId, refreshMe, personalReads, preferences, revision } = useStudySessionContext()
  const view = readExamView(preferences.values.exam)
  const selectedId = view.screen === 'exam' ? view.id : null
  const [loaded, setLoaded] = useState<ExamData | null>(null)
  const exam = loaded?.id === selectedId ? loaded : null
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [countEdit, setCountEdit] = useState<string>()
  const questionCount = countEdit ?? String(view.count)
  const loadingNow = useRef(false)
  const [restoreAttempt, setRestoreAttempt] = useState(0)
  const [restoreError, setRestoreError] = useState<{ id: string; message: string }>()
  const list = useStudyData<{ exams: ExamSummary[] }>(exam ? null : '/api/exams', revision, personalReads)
  const activeDraft = list.data?.exams.find((entry) => entry.status === 'draft')
  const historyItems = list.data?.exams.filter((entry) => entry.status === 'submitted') ?? []

  function saveView(change: Partial<ExamView>) {
    preferences.save({ exam: { ...view, ...change } })
  }

  useEffect(() => {
    if (!selectedId || exam) return
    let active = true
    void requestJson<{ exam: ExamData }>(`/api/exams/${selectedId}`, { headers: { 'X-Study-Account': userId } }).then(({ exam: restored }) => {
      if (active) setLoaded(restored)
    }, (cause: unknown) => {
      if (active) setRestoreError({ id: selectedId, message: cause instanceof StudyRequestError ? cause.message : '试卷暂时无法恢复，请重试。' })
    })
    return () => { active = false }
  }, [exam, restoreAttempt, selectedId, userId])

  async function load(kind: 'new' | 'open' | 'replay', id?: string, afterLoad?: () => void) {
    if (loadingNow.current) return
    loadingNow.current = true
    setBusy(true)
    setError('')
    try {
      const response = kind === 'open'
        ? await requestJson<{ exam: ExamData }>(`/api/exams/${id}`, { headers: { 'X-Study-Account': userId } })
        : await writeJson<{ exam: ExamData }>(kind === 'replay' ? `/api/exams/${id}/replay` : '/api/exams', userId, 'POST',
          kind === 'new' ? { questionCount: Number(questionCount) } : undefined)
      afterLoad?.()
      setLoaded(response.exam)
      if (selectedId !== response.exam.id) saveView({ screen: 'exam', id: response.exam.id, wrongOnly: false })
      if (kind !== 'open') refreshMe()
      window.scrollTo(0, 0)
    } catch (cause) {
      setError(cause instanceof StudyRequestError ? cause.message : '试卷暂时无法读取，请重试。')
    } finally { loadingNow.current = false; setBusy(false) }
  }

  function returnToEntrance() {
    saveView({ screen: 'entrance', id: null })
    setError('')
    setRestoreError(undefined)
    window.scrollTo(0, 0)
  }

  if (exam?.status === 'draft') return <>
    {error && <p className="study-message error" role="alert">{error}</p>}
    <ExamTaking key={`${exam.id}:${exam.revision}`} exam={exam} onReload={(afterLoad) => void load('open', exam.id, afterLoad)}
    onResult={(result) => {
      setLoaded(result)
      saveView({ wrongOnly: false })
      refreshMe()
      window.scrollTo(0, 0)
    }} />
  </>
  if (exam?.status === 'submitted') return <>
    {error && <p className="study-message error" role="alert">{error}</p>}
    <ExamResult exam={exam} onBack={returnToEntrance} onRetry={() => void load('replay', exam.id)} busy={busy}
      wrongOnly={view.wrongOnly} setWrongOnly={(wrongOnly) => saveView({ wrongOnly })} />
  </>

  if (selectedId) return <section>
    <button type="button" className="btn nav-step" onClick={returnToEntrance}>← 返回</button>
    <LoadMessage loading={restoreError?.id !== selectedId} error={restoreError?.id === selectedId ? restoreError.message : null}
      retry={() => { setRestoreError(undefined); setRestoreAttempt((count) => count + 1) }} />
  </section>

  if (view.screen === 'history') return <section className="exam-history-page" aria-labelledby="exam-history">
    <div className="exam-history-header">
      <button type="button" className="btn btn-sm nav-step" onClick={returnToEntrance}>← 返回</button>
      <h3 id="exam-history">考试历史</h3>
    </div>
    {error && <p className="study-message error" role="alert">{error}</p>}
    {historyItems.length === 0 ? <LoadMessage loading={list.loading} error={list.error} retry={list.retry} empty="暂无考试记录" /> : historyItems.map((item) => (
      <button key={item.id} type="button" className="exam-history-item" disabled={busy} onClick={() => void load('open', item.id)}>
        <span className="exam-history-main"><span className="exam-history-date">{examDate(item)}</span><span className="exam-history-score">{item.score}/{item.total ?? DEFAULT_EXAM_QUESTIONS}</span></span>
        <span className="exam-history-meta">用时 {clock(elapsedSeconds(item))}</span>
      </button>
    ))}
  </section>

  return <section className="exam-start" aria-labelledby="exam-title">
    <h2 id="exam-title">模拟考试</h2>
    <p className="exam-start-subtitle">从题库随机组卷</p>
    <div className="exam-info-chips"><span className="exam-info-chip">单选+多选</span><span className="exam-info-chip">⏱ 不限时</span></div>
    {activeDraft ? <p className="exam-resume"><button type="button" className="btn primary btn-start-exam" disabled={busy} aria-busy={busy || undefined} onClick={() => void load('open', activeDraft.id)}>
      {busy ? '正在读取试卷…' : `继续上次考试（${activeDraft.total ?? DEFAULT_EXAM_QUESTIONS} 题） →`}
    </button></p> : <form className="exam-size-form" onSubmit={(event) => {
      event.preventDefault()
      if (isExamQuestionCount(Number(questionCount))) void load('new')
    }}>
      <div className="exam-size-field">
        <label htmlFor="exam-question-count">题数</label>
        <input id="exam-question-count" type="number" inputMode="numeric" min={MIN_EXAM_QUESTIONS} max={MAX_EXAM_QUESTIONS}
          step={1} required value={questionCount} disabled={busy} aria-describedby="exam-size-range"
          onChange={(event) => {
            setCountEdit(event.target.value)
            const count = Number(event.target.value)
            if (isExamQuestionCount(count)) saveView({ count })
          }} />
        <span id="exam-size-range">{MIN_EXAM_QUESTIONS}–{MAX_EXAM_QUESTIONS} 题</span>
      </div>
      <button type="submit" className="btn primary btn-start-exam" aria-busy={busy || undefined} disabled={busy || !isExamQuestionCount(Number(questionCount))}>
        {busy ? '正在读取试卷…' : '开始考试'}<span className="btn-arrow"> →</span>
      </button>
    </form>}
    <p><button type="button" className="btn btn-exam-history nav-step" onClick={() => saveView({ screen: 'history' })}>历史记录{historyItems.length > 0 ? `（${historyItems.length}）` : ''}</button></p>
    {list.error && <div className="study-message error" role="alert">无法读取草稿和历史。 <button type="button" className="btn btn-sm" onClick={list.retry}>重试</button></div>}
    {error && <p className="study-message error" role="alert">{error}</p>}
  </section>
}

export function Exam() {
  const { preferences } = useStudySessionContext()
  return preferences.ready ? <ExamContent /> : <LoadMessage loading />
}
