'use client'

import { useEffect, useRef, useState } from 'react'
import { answerLetters, letter, type Question, requestJson, StudyRequestError, writeJson } from './api'
import { ExplanationPanel, LoadMessage } from './controls'
import { type Exam as ExamData, useExamDraft } from './exam-draft'
import { useQuestionStates, useStudySessionContext } from './study-shell'
import { useStudyData } from './use-study-data'

type ExamSummary = Pick<ExamData, 'id' | 'status' | 'startedAt' | 'submittedAt' | 'score'> & { total?: number }

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
  const { setFavorite } = useStudySessionContext()
  const { data } = useQuestionStates([question.id])
  const [override, setOverride] = useState<boolean>()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(false)
  const favorite = override ?? data?.states[question.id]?.isFavorite ?? (data ? false : undefined)

  async function toggle() {
    if (favorite === undefined || saving) return
    setSaving(true)
    setOverride(!favorite)
    setError(false)
    try { await setFavorite(question.id, !favorite) } catch { setOverride(favorite); setError(true) }
    finally { setSaving(false) }
  }

  return <>
    <button className="btn btn-sm" type="button" aria-pressed={Boolean(favorite)} disabled={saving || favorite === undefined} onClick={() => void toggle()}>
      {favorite ? '★ 取消收藏' : '☆ 收藏'}
    </button>
    {error && <p className="study-message error" role="alert">收藏未保存，请重试。</p>}
  </>
}

function ExamTaking({ exam, onResult, onReload }: { exam: ExamData; onResult: (exam: ExamData) => void; onReload: () => void }) {
  const { userId, markExamActive } = useStudySessionContext()
  const { draft, update, flush, submit, syncStatus, abandonLocalDraft } = useExamDraft(userId, exam)
  const [submitting, setSubmitting] = useState(false)
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
    if (blocked) return
    if (autoAdvance.current) clearTimeout(autoAdvance.current)
    const missing = count - done
    if (!window.confirm(missing ? `还有 ${missing} 道题未作答，确定交卷吗？` : '确定交卷吗？')) return
    setError('')
    setSubmitting(true)
    try { onResult(await submit()) } catch (cause) {
      setError(cause instanceof StudyRequestError && cause.status === 409 ? '草稿已有更新，请核对云端草稿后再交卷。' : '交卷失败，请检查网络后重试。')
    } finally { setSubmitting(false) }
  }

  if (!item) return <LoadMessage error="试卷内容暂不可用。" retry={onReload} />

  return <>
    <div className="exam-header">
      <div className="exam-header-left">
        <div className="exam-progress-row"><span className="exam-progress-label">答题进度</span><span className="exam-progress-count">{done}<span className="exam-progress-total">/{count}</span></span></div>
        <div className="exam-progress-bar" role="progressbar" aria-label="答题进度" aria-valuenow={done} aria-valuemin={0} aria-valuemax={count}>
          <div className="exam-progress-fill" style={{ width: `${done / count * 100}%` }} />
        </div>
      </div>
      <ExamTimer exam={exam} />
      <button type="button" className="btn btn-submit-exam" disabled={blocked} onClick={() => void handIn()}>{submitting ? '交卷中…' : '交卷'}</button>
    </div>
    <p className="study-message" role="status">{markers[syncStatus]}{' '}
      {syncStatus === 'error' && <button type="button" className="btn btn-sm" onClick={() => void flush().catch(() => {})}>重试同步</button>}
      {syncStatus === 'conflict' && <button type="button" className="btn btn-sm" onClick={() => {
        if (!window.confirm('改用云端草稿将放弃本机未同步的修改。确定继续吗？')) return
        abandonLocalDraft()
        onReload()
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
        <button type="button" className="btn" disabled={position === 0 || blocked} onClick={() => move(position - 1)}>上一题</button>
        {item.type === 'multiple' && <button type="button" className="btn primary" disabled={position === count - 1 || blocked} onClick={() => move(position + 1)}>确定</button>}
        <button type="button" className="btn" disabled={position === count - 1 || blocked} onClick={() => move(position + 1)}>下一题</button>
        <ExamFavorite key={item.id} question={item} />
        <button type="button" className="btn btn-sm" disabled={blocked} aria-pressed={draft.marked.includes(item.id)} onClick={() => update({
          marked: draft.marked.includes(item.id) ? draft.marked.filter((id) => id !== item.id) : [...draft.marked, item.id],
        })}>🏷 {draft.marked.includes(item.id) ? '已标记' : '标记'}</button>
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
    {question.explanation && <button type="button" className="btn btn-sm" onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>{expanded ? '收起解析' : '展开解析'}</button>}
    {expanded && question.explanation && <ExplanationPanel content={{ answerIds, explanation: question.explanation, options: question.options, sources: question.sources ?? [] }} />}
  </article>
}

function ExamResult({ exam, onBack, onRetry }: { exam: ExamData; onBack: () => void; onRetry: () => void }) {
  const [wrongOnly, setWrongOnly] = useState(false)
  const score = exam.score ?? 0
  const count = exam.items.length
  const rate = count ? Math.round(score / count * 100) : 0
  const circumference = 326.73

  return <div className="exam-result">
    <h2>考试结果</h2>
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
    <div className="exam-result-actions"><button type="button" className="btn primary" onClick={onRetry}>重新考试</button><button type="button" className="btn" onClick={onBack}>返回</button></div>
  </div>
}

export function Exam() {
  const { userId, refreshMe } = useStudySessionContext()
  const [exam, setExam] = useState<ExamData | null>(null)
  const [history, setHistory] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const marker = `cqu-study-current-exam:${userId}`
  const list = useStudyData<{ exams: ExamSummary[] }>(exam ? null : '/api/exams', revision)
  const activeDraft = list.data?.exams.find((entry) => entry.status === 'draft')
  const historyItems = list.data?.exams.filter((entry) => entry.status === 'submitted') ?? []

  useEffect(() => {
    let id: string | null = null
    try { id = sessionStorage.getItem(marker) } catch { /* Continue from the exam entrance. */ }
    if (!id || !/^[\da-f-]{36}$/i.test(id)) return
    let active = true
    void requestJson<{ exam: ExamData }>(`/api/exams/${id}`).then(({ exam: restored }) => {
      if (active) setExam((previous) => previous ?? restored)
    }, () => { /* The exam entrance retains any confirmed cloud drafts. */ })
    return () => { active = false }
  }, [marker])

  async function load(id?: string) {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const response = id ? await requestJson<{ exam: ExamData }>(`/api/exams/${id}`) : await writeJson<{ exam: ExamData }>('/api/exams', userId, 'POST')
      setExam(response.exam)
      if (response.exam.status === 'draft') {
        try { sessionStorage.setItem(marker, response.exam.id) } catch { /* Manual cloud-draft recovery remains available. */ }
      }
    } catch (cause) {
      setError(cause instanceof StudyRequestError ? cause.message : '试卷暂时无法读取，请重试。')
    } finally { setBusy(false) }
  }

  function returnToEntrance() {
    try { sessionStorage.removeItem(marker) } catch { /* The current tab still returns to the exam entrance. */ }
    setExam(null)
    setRevision((previous) => previous + 1)
  }

  if (exam?.status === 'draft') return <ExamTaking key={`${exam.id}:${exam.revision}`} exam={exam} onReload={() => void load(exam.id)}
    onResult={(result) => {
      try { sessionStorage.removeItem(marker) } catch { /* The submitted result is stored by the server. */ }
      setExam(result)
      refreshMe()
    }} />
  if (exam?.status === 'submitted') return <>
    {error && <p className="study-message error" role="alert">{error}</p>}
    <ExamResult exam={exam} onBack={returnToEntrance} onRetry={() => void load()} />
  </>

  if (history) return <section className="exam-history-page" aria-labelledby="exam-history">
    <div className="exam-history-header"><button type="button" className="btn btn-sm" onClick={() => setHistory(false)}>← 返回</button><h3 id="exam-history">考试历史</h3><span /></div>
    {error && <p className="study-message error" role="alert">{error}</p>}
    {historyItems.length === 0 ? <LoadMessage loading={list.loading} error={list.error} retry={list.retry} empty="暂无考试记录" /> : historyItems.map((item) => (
      <button key={item.id} type="button" className="exam-history-item" disabled={busy} onClick={() => void load(item.id)}>
        <span className="exam-history-main"><span className="exam-history-date">{examDate(item)}</span><span className="exam-history-score">{item.score}/{item.total ?? 50}</span></span>
        <span className="exam-history-meta">用时 {clock(elapsedSeconds(item))}</span>
      </button>
    ))}
  </section>

  return <section className="exam-start" aria-labelledby="exam-title">
    <h2 id="exam-title">模拟考试</h2>
    <p className="exam-start-subtitle">随机抽取 50 题 · 单选多选混合 · 不限时</p>
    <div className="exam-info-chips"><span className="exam-info-chip">50 题</span><span className="exam-info-chip">单选+多选</span><span className="exam-info-chip">⏱ 不限时</span></div>
    {activeDraft && <p className="exam-resume"><button type="button" className="btn primary btn-start-exam" disabled={busy} onClick={() => void load(activeDraft.id)}>继续上次考试 →</button></p>}
    <button type="button" className="btn primary btn-start-exam" disabled={busy} onClick={() => void load()}>
      {busy ? '正在读取试卷…' : '开始考试'}<span className="btn-arrow"> →</span>
    </button>
    <p><button type="button" className="btn btn-exam-history" onClick={() => setHistory(true)}>历史记录{historyItems.length > 0 ? `（${historyItems.length}）` : ''}</button></p>
    {list.error && <div className="study-message error" role="alert">无法读取草稿和历史。 <button type="button" className="btn btn-sm" onClick={list.retry}>重试</button></div>}
    {error && <p className="study-message error" role="alert">{error}</p>}
  </section>
}
