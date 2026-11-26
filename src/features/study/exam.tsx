'use client'

import { useEffect, useRef, useState } from 'react'
import { answerLetters, letter, type Question, requestJson, StudyRequestError, writeJson } from './api'
import { ExplanationPanel, LoadMessage } from './controls'
import { type Exam as ExamData, readLocalExamDraft, useExamDraft } from './exam-draft'
import { type ExamAnswerConflict, unsubmittedAnswerIds } from './exam-draft-merge'
import { DEFAULT_EXAM_QUESTIONS, isExamQuestionCount, MAX_EXAM_QUESTIONS, MIN_EXAM_QUESTIONS } from './exam-size'
import { useQuestionFavorite, useQuestionStates, useStudySessionContext } from './study-shell'
import { useStudyData } from './use-study-data'

type ExamSummary = Pick<ExamData, 'id' | 'status' | 'startedAt' | 'submittedAt' | 'score'> & { total?: number }
export type ExamHistory = { exams: ExamSummary[] }
type ExamFilter = 'all' | 'wrong' | 'marked'
type ExamView = { screen: 'entrance' | 'history' | 'exam'; id: string | null; count: number; filter: ExamFilter; fromHistory: boolean }

function readExamView(value: unknown): ExamView {
  const saved = value as (Partial<ExamView> & { wrongOnly?: boolean }) | undefined
  const id = typeof saved?.id === 'string' && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(saved.id) ? saved.id : null
  const screen = saved?.screen === 'history' ? 'history' : saved?.screen === 'exam' && id ? 'exam' : 'entrance'
  const preferredFilter = saved?.filter
  const filter = preferredFilter === 'all' || preferredFilter === 'wrong' || preferredFilter === 'marked'
    ? preferredFilter : saved?.wrongOnly === true ? 'wrong' : 'all'
  return { screen, id, count: isExamQuestionCount(saved?.count) ? saved.count : DEFAULT_EXAM_QUESTIONS, filter, fromHistory: saved?.fromHistory === true }
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

function ExamConflictReview({ conflicts, items, onResolve }: {
  conflicts: ExamAnswerConflict[]; items: Question[]
  onResolve: (choices: Record<string, 'local' | 'cloud'>) => void
}) {
  const [choices, setChoices] = useState<Record<string, 'local' | 'cloud'>>({})
  const byId = new Map(conflicts.map((conflict) => [conflict.id, conflict]))
  return <form className="exam-conflict-review" aria-labelledby="exam-conflict-title" onSubmit={(event) => {
    event.preventDefault()
    onResolve(choices)
  }}>
    <h3 id="exam-conflict-title">确认冲突的答案</h3>
    {items.map((question, index) => {
      const conflict = byId.get(question.id)
      if (!conflict) return null
      return <fieldset key={question.id}>
        <legend>第 {index + 1} 题 · {question.stem}</legend>
        {(['local', 'cloud'] as const).map((side) => {
          const answers = answerLetters(question.options, conflict[side]) || '未作答'
          const text = question.options.filter((option) => conflict[side].includes(option.id)).map((option) => option.text).join('、')
          return <label key={side}>
            <input type="radio" name={question.id} value={side} checked={choices[question.id] === side}
              onChange={() => setChoices((previous) => ({ ...previous, [question.id]: side }))} required />
            <span>{side === 'local' ? '本机答案' : '云端答案'} · {answers}{text && `（${text}）`}</span>
          </label>
        })}
      </fieldset>
    })}
    <button className="btn primary" type="submit" disabled={Object.keys(choices).length !== conflicts.length}>合并并继续</button>
  </form>
}

function ExamTaking({ exam, onResult, onReload }: {
  exam: ExamData; onResult: (exam: ExamData, elsewhere: boolean) => void; onReload: () => void
}) {
  const { userId, markExamActive } = useStudySessionContext()
  const { draft, update, flush, submit, syncStatus, pendingMerge, resolve, finished } = useExamDraft(userId, exam)
  const [submitting, setSubmitting] = useState(false)
  const submittingNow = useRef(false)
  const confirmation = useRef<HTMLDialogElement>(null)
  const [error, setError] = useState('')
  const [reviewNotice, setReviewNotice] = useState(false)
  const autoAdvance = useRef<ReturnType<typeof setTimeout> | null>(null)
  const count = exam.items.length
  const position = Math.min(Math.max(draft.position, 0), count - 1)
  const item = exam.items[position]
  const done = Object.values(draft.answers).filter((choices) => choices.length > 0).length
  const selected = draft.answers[item?.id] ?? []
  const markers = { local: '草稿本地已保存，待同步', synced: '草稿已云端同步', pending: '草稿正在保存', error: '草稿同步失败', conflict: '同一道题在本机与云端的答案不同，请选择保留哪一份。' }
  const blocked = submitting || !!pendingMerge || !!finished

  useEffect(() => () => { if (autoAdvance.current) clearTimeout(autoAdvance.current) }, [])
  useEffect(() => {
    markExamActive(true)
    return () => markExamActive(false)
  }, [markExamActive])
  useEffect(() => {
    if (finished) onResult(finished.exam, finished.elsewhere)
  }, [finished, onResult])
  useEffect(() => {
    if (pendingMerge) confirmation.current?.close()
  }, [pendingMerge])

  function move(index: number) {
    if (autoAdvance.current) clearTimeout(autoAdvance.current)
    if (index >= 0 && index < count) update(() => ({ position: index }))
  }

  function choose(id: string) {
    if (autoAdvance.current) clearTimeout(autoAdvance.current)
    update((current) => {
      const previous = current.answers[item.id] ?? []
      const answer = item.type === 'single' ? [id] : previous.includes(id) ? previous.filter((value) => value !== id) : [...previous, id]
      return { answers: { ...current.answers, [item.id]: answer } }
    })
    if (item.type === 'single' && position + 1 < count) autoAdvance.current = setTimeout(() => move(position + 1), 180)
  }

  function confirmHandIn() {
    if (blocked || confirmation.current?.open) return
    if (autoAdvance.current) clearTimeout(autoAdvance.current)
    setError('')
    setReviewNotice(false)
    confirmation.current?.showModal()
  }

  async function handIn() {
    if (blocked || submittingNow.current || !confirmation.current?.open) return
    setError('')
    submittingNow.current = true
    setSubmitting(true)
    try {
      setReviewNotice(await submit())
      confirmation.current?.close()
    } catch (cause) {
      setError(cause instanceof StudyRequestError && cause.status === 409 ? '其他设备正在同步试卷，请稍后重试。' : '交卷失败，请检查网络后重试。')
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
      <button type="button" className="btn btn-submit-exam" disabled={blocked} onClick={confirmHandIn}>交卷</button>
    </div>
    <dialog ref={confirmation} className="exam-submit-dialog" aria-labelledby="exam-submit-title" aria-describedby="exam-submit-description"
      onCancel={(event) => { if (submittingNow.current) event.preventDefault() }}>
      <h2 id="exam-submit-title">确认交卷</h2>
      <p id="exam-submit-description">
        {count > done ? `还有 ${count - done} 道题未作答。交卷后可查看成绩和解析。` : '交卷后可查看成绩和解析。'}
      </p>
      {error && <p className="study-message error" role="alert">{error}</p>}
      <div className="exam-submit-actions">
        <button className="btn" type="button" disabled={submitting} onClick={() => confirmation.current?.close()}>继续答题</button>
        <button className="btn primary" type="button" disabled={blocked} aria-busy={submitting || undefined} onClick={() => void handIn()}>
          {submitting ? '交卷中…' : '确认交卷'}
        </button>
      </div>
    </dialog>
    <p className="study-message" role="status">{markers[syncStatus]}{' '}
      {syncStatus === 'error' && <button type="button" className="btn btn-sm" onClick={() => void flush().catch(() => {})}>重试同步</button>}
    </p>
    {reviewNotice && <p className="study-message" role="status">草稿已更新，请核对答案后再交卷。</p>}
    {pendingMerge && <ExamConflictReview key={pendingMerge.cloud.revision} conflicts={pendingMerge.conflicts} items={exam.items} onResolve={resolve} />}
    <article className="question-card exam-question-card" aria-label="当前考题">
      <div className="q-header"><span className={`q-type ${item.type}`}>{item.type === 'single' ? '单选题' : '多选题'}</span><span className="progress-info">第 {position + 1}/{count} 题</span></div>
      <p className="q-text">{item.stem}</p>
      <div className="options-list" role="group" aria-label="选择答案">
        {item.options.map((option, index) => <button key={option.id} type="button" className={`option ${selected.includes(option.id) ? 'selected' : ''}`}
          disabled={blocked} aria-pressed={selected.includes(option.id)} onClick={() => choose(option.id)}>{letter(index)}. {option.text}</button>)}
      </div>
      <div className="action-bar">
        <button type="button" className="btn nav-step" disabled={position === 0 || blocked} onClick={() => move(position - 1)}>上一题</button>
        {item.type === 'multiple' && <button type="button" className="btn primary nav-step" disabled={!selected.length || blocked}
          onClick={() => position === count - 1 ? confirmHandIn() : move(position + 1)}>确定</button>}
        <button type="button" className="btn nav-step" disabled={position === count - 1 || blocked} onClick={() => move(position + 1)}>下一题</button>
        <ExamFavorite key={item.id} question={item} />
        <button type="button" className="btn btn-sm exam-mark" disabled={blocked} aria-pressed={draft.marked.includes(item.id)} onClick={() => update((current) => ({
          marked: current.marked.includes(item.id) ? current.marked.filter((id) => id !== item.id) : [...current.marked, item.id],
        }))}>
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

function ResultItem({ exam, question, index, marked }: { exam: ExamData; question: Question; index: number; marked: boolean }) {
  const [expanded, setExpanded] = useState(false)
  const correct = Boolean(exam.correctness?.[question.id])
  const answerIds = question.answerIds ?? []
  const selected = exam.answers[question.id] ?? []

  return <article className={`exam-result-item ${correct ? 'result-correct' : 'result-wrong'}`}>
    <div className="exam-result-header">
      <span className={`q-num${correct ? ' result-correct' : ''}`}>{correct ? '✓' : '✗'}</span>
      <span className="exam-result-num">{index + 1}</span>
      <span className={`q-type ${question.type}`}>{question.type === 'single' ? '单选题' : '多选题'}</span>
      {marked && <span className="progress-info">已标记</span>}
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

function ExamResult({ exam, onBack, onRetry, filter, setFilter, busy }: {
  exam: ExamData; onBack: () => void; onRetry: () => void; filter: ExamFilter
  setFilter: (value: ExamFilter) => void; busy: boolean
}) {
  const { userId } = useStudySessionContext()
  const [local] = useState(() => readLocalExamDraft(userId, exam.id))
  const unsubmitted = new Set(local ? unsubmittedAnswerIds(local, exam) : [])
  const score = exam.score ?? 0
  const count = exam.items.length
  const rate = count ? Math.round(score / count * 100) : 0
  const marked = new Set(exam.marked)
  const filters: { id: ExamFilter; label: string }[] = [
    { id: 'all', label: `全部 ${count}` },
    { id: 'wrong', label: `仅错题 ${count - score}` },
  ]
  if (marked.size) filters.push({ id: 'marked', label: `仅标记 ${marked.size}` })
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
    {local && unsubmitted.size > 0 && <details className="exam-unsubmitted">
      <summary>本机有 {unsubmitted.size} 道题的未同步答案，未计入成绩</summary>
      <ul>{exam.items.map((question, index) => unsubmitted.has(question.id) &&
        <li key={question.id}>第 {index + 1} 题 · {answerLetters(question.options, local.draft.answers[question.id]) || '未作答'}</li>
      )}</ul>
    </details>}
    <div className="exam-result-filter">
      {filters.map(({ id, label }) => <button key={id} type="button" className={`filter-chip ${filter === id ? 'active' : ''}`}
        aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}</button>)}
    </div>
    {exam.items.map((question, index) => {
      const isMarked = marked.has(question.id)
      if ((filter === 'wrong' && exam.correctness?.[question.id]) || (filter === 'marked' && !isMarked)) return null
      return <ResultItem key={question.id} exam={exam} question={question} index={index} marked={isMarked} />
    })}
    <div className="exam-result-actions">
      {replayButton}
      <button type="button" className="btn nav-step" onClick={onBack} disabled={busy}>返回</button>
    </div>
  </div>
}

function ExamContent({ initialHistory }: { initialHistory?: Promise<ExamHistory | null> }) {
  const { userId, refreshMe, personalReads, preferences, revision } = useStudySessionContext()
  const view = readExamView(preferences.values.exam)
  const selectedId = view.screen === 'exam' ? view.id : null
  const [loaded, setLoaded] = useState<ExamData | null>(null)
  const exam = loaded?.id === selectedId ? loaded : null
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [submittedElsewhere, setSubmittedElsewhere] = useState(false)
  const [replayNotice, setReplayNotice] = useState('')
  const [foundDraft, setFoundDraft] = useState<ExamSummary>()
  const [countEdit, setCountEdit] = useState<string>()
  const questionCount = countEdit ?? String(view.count)
  const loadingNow = useRef(false)
  const [restoreAttempt, setRestoreAttempt] = useState(0)
  const [restoreError, setRestoreError] = useState<{ id: string; message: string }>()
  const list = useStudyData<ExamHistory>(exam ? null : '/api/exams', revision, { ...personalReads, initial: initialHistory })
  const activeDraft = foundDraft ?? list.data?.exams.find((entry) => entry.status === 'draft')
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

  async function load(kind: 'new' | 'open' | 'replay', id?: string) {
    if (loadingNow.current || (kind === 'new' && (!list.data || activeDraft))) return
    loadingNow.current = true
    setBusy(true)
    setError('')
    try {
      const requestedCount = Number(questionCount)
      const response: { exam: ExamData; reusedDraft?: boolean } = kind === 'open'
        ? await requestJson(`/api/exams/${id}`, { headers: { 'X-Study-Account': userId } })
        : await writeJson(kind === 'replay' ? `/api/exams/${id}/replay` : '/api/exams', userId, 'POST',
          kind === 'new' ? { questionCount: requestedCount } : undefined)
      if (kind === 'new' && (response.reusedDraft || response.exam.items.length !== requestedCount)) {
        setFoundDraft({ ...response.exam, total: response.exam.items.length })
        setError('已有一份未交卷的试卷，请选择继续上次考试。')
        refreshMe()
        return
      }
      setFoundDraft(undefined)
      setSubmittedElsewhere(false)
      setReplayNotice(kind === 'replay' && exam && response.exam.items.length < exam.items.length
        ? `原卷中有题目已下架，本次重考共 ${response.exam.items.length} 题。` : '')
      setLoaded(response.exam)
      if (selectedId !== response.exam.id) saveView({
        screen: 'exam', id: response.exam.id, filter: 'all', fromHistory: kind === 'open' && view.screen === 'history',
      })
      if (kind !== 'open') refreshMe()
      window.scrollTo(0, 0)
    } catch (cause) {
      setError(cause instanceof StudyRequestError ? cause.message : '试卷暂时无法读取，请重试。')
    } finally { loadingNow.current = false; setBusy(false) }
  }

  function returnFromExam() {
    saveView({ screen: view.screen === 'exam' && view.fromHistory ? 'history' : 'entrance', id: null, fromHistory: false })
    setError('')
    setRestoreError(undefined)
    window.scrollTo(0, 0)
  }

  if (exam?.status === 'draft') return <>
    {error && <p className="study-message error" role="alert">{error}</p>}
    {replayNotice && <p className="study-message" role="status">{replayNotice}</p>}
    <ExamTaking key={`${exam.id}:${exam.revision}`} exam={exam} onReload={() => void load('open', exam.id)}
    onResult={(result, elsewhere) => {
      setSubmittedElsewhere(elsewhere)
      setLoaded(result)
      saveView({ screen: 'exam', id: result.id, filter: 'all' })
      refreshMe()
      window.scrollTo(0, 0)
    }} />
  </>
  if (exam?.status === 'submitted') return <>
    {error && <p className="study-message error" role="alert">{error}</p>}
    {submittedElsewhere && <p className="study-message" role="status">这份试卷已交卷，以下是云端结果。</p>}
    <ExamResult key={exam.id} exam={exam} onBack={returnFromExam} onRetry={() => void load('replay', exam.id)} busy={busy}
      filter={view.filter} setFilter={(filter) => saveView({ filter })} />
  </>

  if (selectedId) return <section>
    <button type="button" className="btn nav-step" onClick={returnFromExam}>← 返回</button>
    <LoadMessage loading={restoreError?.id !== selectedId} error={restoreError?.id === selectedId ? restoreError.message : null}
      retry={() => { setRestoreError(undefined); setRestoreAttempt((count) => count + 1) }} />
  </section>

  if (view.screen === 'history') return <section className="exam-history-page" aria-labelledby="exam-history">
    <div className="exam-history-header">
      <button type="button" className="btn btn-sm nav-step" onClick={returnFromExam}>← 返回</button>
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
    </button></p> : list.data ? <form className="exam-size-form" onSubmit={(event) => {
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
        {busy ? '正在生成试卷…' : '开始考试'}<span className="btn-arrow"> →</span>
      </button>
    </form> : list.loading ? <p className="study-message" role="status">正在检查考试草稿…</p> : null}
    <p><button type="button" className="btn btn-exam-history nav-step" onClick={() => saveView({ screen: 'history' })}>历史记录{historyItems.length > 0 ? `（${historyItems.length}）` : ''}</button></p>
    {list.error && <div className="study-message error" role="alert">无法读取草稿和历史。 <button type="button" className="btn btn-sm" onClick={list.retry}>重试</button></div>}
    {error && <p className="study-message error" role="alert">{error}</p>}
  </section>
}

export function Exam({ initialHistory }: { initialHistory?: Promise<ExamHistory | null> }) {
  const { preferences } = useStudySessionContext()
  return preferences.ready ? <ExamContent initialHistory={initialHistory} /> : <LoadMessage loading />
}
