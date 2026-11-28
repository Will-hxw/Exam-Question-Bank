'use client'

import Image from 'next/image'
import { type CSSProperties, useEffect, useRef, useState } from 'react'
import { BookmarkIcon } from '@/components/icons'
import { Badge, BottomDrawer, Button, OptionCard, ProgressBar, StatTile, TextInput } from '@/components/ui'
import { messages } from '@/config/messages'
import { siteConfig } from '@/config/site'
import { cssVarRef } from '@/config/theme'
import { answerLetters, letter, type Question, requestJson, StudyRequestError, writeJson } from './api'
import { LoadMessage } from './controls'
import { ExamResultItem } from './exam-result-item'
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
  return <span className="tabular-nums px-3 py-1.5 rounded-micro bg-surface text-sm font-semibold text-ink-primary">{clock(elapsedSeconds(exam, now))}</span>
}

function ExamFavorite({ question }: { question: Question }) {
  useQuestionStates([question.id])
  const favoriteControl = useQuestionFavorite(question.id)

  return (
    <>
      <button
        className={`tactile w-9 h-9 rounded-micro flex items-center justify-center shrink-0 ${favoriteControl.favorite ? 'bg-missed-fill text-missed-badge' : 'bg-surface text-ink-secondary hover:bg-surface-hover'}`}
        type="button"
        aria-pressed={favoriteControl.favorite}
        aria-busy={favoriteControl.pending || undefined}
        aria-label={favoriteControl.favorite ? messages.common.unfavoriteQuestion : messages.common.favoriteQuestion}
        onClick={favoriteControl.toggle}
      >
        <BookmarkIcon filled={favoriteControl.favorite} />
      </button>
      {favoriteControl.error && <p className="m-0 text-xs text-wrong-ink" role="alert">{favoriteControl.error}</p>}
    </>
  )
}

function ExamConflictReview({ conflicts, items, onResolve }: {
  conflicts: ExamAnswerConflict[]; items: Question[]
  onResolve: (choices: Record<string, 'local' | 'cloud'>) => void
}) {
  const [choices, setChoices] = useState<Record<string, 'local' | 'cloud'>>({})
  const byId = new Map(conflicts.map((conflict) => [conflict.id, conflict]))
  return (
    <form
      className="p-5 rounded-option bg-missed-fill mb-6 flex flex-col gap-4"
      aria-labelledby="exam-conflict-title"
      onSubmit={(event) => { event.preventDefault(); onResolve(choices) }}
    >
      <h3 id="exam-conflict-title" className="font-serif m-0 text-base font-bold text-missed-ink">{messages.exam.conflictTitle}</h3>
      {items.map((question, index) => {
        const conflict = byId.get(question.id)
        if (!conflict) return null
        return (
          <fieldset key={question.id} className="border-0 m-0 p-0 flex flex-col gap-2">
            <legend className="text-sm font-medium text-ink-primary mb-1.5">{messages.exam.questionNumber(index)} {question.stem}</legend>
            {(['local', 'cloud'] as const).map((side) => {
              const answers = answerLetters(question.options, conflict[side]) || messages.common.unanswered
              const text = question.options.filter((option) => conflict[side].includes(option.id)).map((option) => option.text).join('、')
              return (
                <label key={side} className="p-3 rounded-compact bg-canvas flex items-center gap-2.5 text-sm cursor-pointer">
                  <input
                    type="radio"
                    name={question.id}
                    value={side}
                    checked={choices[question.id] === side}
                    onChange={() => setChoices((previous) => ({ ...previous, [question.id]: side }))}
                    required
                  />
                  <span>{side === 'local' ? messages.exam.localAnswer : messages.exam.cloudAnswer} · {answers}{text && `（${text}）`}</span>
                </label>
              )
            })}
          </fieldset>
        )
      })}
      <Button variant="cta" size="md" className="h-11 px-5 rounded-control text-sm self-start" type="submit" disabled={Object.keys(choices).length !== conflicts.length}>
        {messages.exam.mergeAndContinue}
      </Button>
    </form>
  )
}

function ExamTaking({ exam, onResult, onReload }: {
  exam: ExamData; onResult: (exam: ExamData, elsewhere: boolean) => void; onReload: () => void
}) {
  const { userId, markExamActive } = useStudySessionContext()
  const { draft, update, flush, submit, syncStatus, pendingMerge, resolve, finished } = useExamDraft(userId, exam)
  const [submitting, setSubmitting] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [navDirection, setNavDirection] = useState<'forward' | 'backward' | 'jump'>('jump')
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
  const syncLabels: Record<typeof syncStatus, string> = {
    synced: '草稿已云端同步',
    local: '草稿本地已保存，待同步',
    pending: '草稿正在保存',
    error: messages.exam.saveErrorLabel,
    conflict: messages.exam.conflictHint,
  }
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
    setSheetOpen(false)
    if (index >= 0 && index < count) {
      setNavDirection(Math.abs(index - position) > 1 ? 'jump' : index > position ? 'forward' : index < position ? 'backward' : 'jump')
      update(() => ({ position: index }))
    }
  }

  function choose(id: string) {
    if (autoAdvance.current) clearTimeout(autoAdvance.current)
    update((current) => {
      const previous = current.answers[item.id] ?? []
      const answer = item.type === 'single' ? [id] : previous.includes(id) ? previous.filter((value) => value !== id) : [...previous, id]
      return { answers: { ...current.answers, [item.id]: answer } }
    })
    if (item.type === 'single' && position + 1 < count) autoAdvance.current = setTimeout(() => move(position + 1), siteConfig.timings.examAutoAdvanceMs)
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
      setError(cause instanceof StudyRequestError && cause.status === 409 ? messages.exam.conflictSubmitError : messages.exam.submitNetworkError)
    } finally { submittingNow.current = false; setSubmitting(false) }
  }

  if (!item) return <LoadMessage error={messages.exam.paperUnavailable} retry={() => onReload()} />

  const isMarked = draft.marked.includes(item.id)

  const sheetGrid = (
    <div className="grid grid-cols-5 gap-2" role="group" aria-label={messages.exam.navAria}>
      {exam.items.map((question, index) => {
        const isCurrent = index === position
        const answered = Boolean(draft.answers[question.id]?.length)
        const qMarked = draft.marked.includes(question.id)
        let cls = 'bg-surface text-ink-secondary hover:bg-surface-hover'
        if (isCurrent) cls = 'bg-selected-badge text-white'
        else if (qMarked) cls = 'bg-missed-fill text-missed-ink'
        else if (answered) cls = 'bg-selected-fill text-selected-ink'
        return (
          <button
            key={question.id}
            type="button"
            disabled={blocked}
            className={`sheet-cell ${cls}`}
            aria-label={`${messages.exam.questionNumber(index)}，${answered ? '已答' : '未答'}${qMarked ? '，已标记' : ''}`}
            aria-current={isCurrent ? 'step' : undefined}
            onClick={() => move(index)}
          >
            {index + 1}
          </button>
        )
      })}
    </div>
  )

  return (
    <>
      <div className="lg:grid study-two-col">
        <div>
          {/* Mobile top exam status bar */}
          <div className="flex items-center justify-between gap-3 mb-5 lg:hidden">
            <div className="flex items-center gap-2.5">
              <ExamTimer exam={exam} />
              <span className="tabular-nums text-meta font-medium text-ink-secondary">{messages.exam.answeredProgress(done, count)}</span>
            </div>
            <Button variant="cta" size="sm" className="px-4" disabled={blocked} onClick={confirmHandIn}>
              {messages.exam.submitPaper}
            </Button>
          </div>

          <div className={`mb-4 flex items-center gap-2 text-meta ${syncStatus === 'error' ? 'text-wrong-ink' : 'text-ink-secondary'}`} role="status">
            <span>{syncLabels[syncStatus]}</span>
            {syncStatus === 'error' && <Button size="xs" onClick={() => void flush().catch(() => {})}>重试同步</Button>}
          </div>
          {reviewNotice && <p className="mb-3 text-meta text-missed-ink" role="status">{messages.exam.draftUpdatedNotice}</p>}
          {pendingMerge && <ExamConflictReview key={pendingMerge.cloud.revision} conflicts={pendingMerge.conflicts} items={exam.items} onResolve={resolve} />}

          <article
            key={item.id}
            aria-label={messages.exam.currentQuestionAria}
            className={navDirection === 'forward' ? 'animate-slide-next' : navDirection === 'backward' ? 'animate-slide-prev' : 'animate-question-enter'}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <Badge>{item.type === 'single' ? messages.common.singleChoice : messages.common.multipleChoice}</Badge>
                <span className="tabular-nums text-meta font-medium text-ink-secondary">{messages.exam.questionProgress(position + 1, count)}</span>
                <ProgressBar percent={(done / count) * 100} />
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className={`tactile h-9 px-3 rounded-micro text-xs font-medium ${isMarked ? 'bg-missed-fill text-missed-ink' : 'bg-surface text-ink-secondary hover:bg-surface-hover'}`}
                  disabled={blocked}
                  aria-pressed={isMarked}
                  onClick={() => update((current) => ({
                    marked: current.marked.includes(item.id) ? current.marked.filter((id) => id !== item.id) : [...current.marked, item.id],
                  }))}
                >
                  {isMarked ? messages.exam.marked : messages.exam.mark}
                </button>
                <ExamFavorite key={item.id} question={item} />
              </div>
            </div>

            <h1 className="font-serif mt-4 mb-6 text-stem lg:text-stem-lg font-semibold text-ink-primary">
              {item.stem}
            </h1>

            <div className="flex flex-col gap-3" role="group" aria-label={messages.practice.optionsAria}>
              {item.options.map((option, index) => {
                const chosen = selected.includes(option.id)
                return (
                  <OptionCard
                    key={option.id}
                    letter={letter(index)}
                    text={option.text}
                    state={chosen ? 'selected' : 'idle'}
                    staggerIndex={index}
                    disabled={blocked}
                    pressed={chosen}
                    onClick={() => choose(option.id)}
                  />
                )
              })}
            </div>

          </article>
          <nav aria-label="试题操作" className="mt-3 flex items-center gap-2 lg:mt-5">
            <Button className="flex-1 min-h-11 px-2" size="md" disabled={position === 0 || blocked} onClick={() => move(position - 1)}>
              {messages.common.previousQuestion}
            </Button>
            {item.type === 'multiple' && (
              <Button className="flex-1 min-h-11 px-2" variant="cta" size="md" disabled={!selected.length || blocked}
                onClick={() => position === count - 1 ? confirmHandIn() : move(position + 1)}>
                确定
              </Button>
            )}
            <Button className="flex-1 min-h-11 px-2" variant={item.type === 'multiple' ? 'surface' : 'cta'} size="md"
              disabled={(position === count - 1 && item.type === 'multiple') || blocked} onClick={() => position === count - 1 ? confirmHandIn() : move(position + 1)}>
              {position === count - 1 && item.type === 'single' ? messages.exam.submitAndViewResult : messages.common.nextQuestion}
            </Button>
            <Button className="lg:hidden flex-1 min-h-11 px-2" size="md" aria-haspopup="dialog" onClick={(event) => {
              event.currentTarget.focus({ preventScroll: true })
              setSheetOpen(true)
            }}>
              {messages.practice.answerSheet}
            </Button>
          </nav>
        </div>

        {/* Desktop sticky right exam rail */}
        <aside className="study-rail">
          <div className="p-4 rounded-option bg-surface flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-ink-muted">{messages.exam.timerLabel}</span>
              <ExamTimer exam={exam} />
            </div>
            <div className="flex items-center justify-between text-meta">
              <span className="text-ink-secondary">{messages.exam.progressLabel}</span>
              <span className="tabular-nums font-semibold">{done} / {count}</span>
            </div>
            <ProgressBar variant="full" percent={(done / count) * 100} ariaLabel={messages.exam.progressLabel} valueNow={done} valueMax={count} />
            <Button variant="cta" size="md" className="w-full h-11 rounded-control text-sm mt-1" disabled={blocked} onClick={confirmHandIn}>
              {messages.exam.submitPaper}
            </Button>
          </div>
          <div>
            <div className="text-meta font-semibold mb-2.5">{messages.exam.navTitle}</div>
            {sheetGrid}
          </div>
        </aside>
      </div>

      {/* Mobile answer sheet drawer */}
      <BottomDrawer
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title={messages.practice.answerSheet}
        closeLabel={messages.common.close}
      >
        {sheetGrid}
      </BottomDrawer>

      <dialog
        ref={confirmation}
        className="confirm-dialog"
        aria-labelledby="exam-submit-title"
        aria-describedby="exam-submit-description"
        onCancel={(event) => { if (submittingNow.current) event.preventDefault() }}
      >
        <h2 id="exam-submit-title" className="font-serif m-0 text-lg font-bold">{messages.exam.confirmSubmitTitle}</h2>
        <p id="exam-submit-description" className="m-0 mt-2 text-sm text-ink-secondary">
          {count > done ? messages.exam.confirmSubmitUnanswered(count - done) : messages.exam.confirmSubmitAllAnswered}
        </p>
        {error && <p className="m-0 mt-3 text-xs text-wrong-ink" role="alert">{error}</p>}
        <div className="mt-5 flex items-center gap-2.5">
          <Button variant="surface" size="md" className="flex-1 h-11 rounded-control text-sm" disabled={submitting} onClick={() => confirmation.current?.close()}>
            {messages.exam.continueAnswering}
          </Button>
          <Button variant="cta" size="md" className="flex-1 h-11 rounded-control text-sm" disabled={blocked} aria-busy={submitting || undefined} onClick={() => void handIn()}>
            {submitting ? messages.exam.submitting : messages.exam.confirmSubmitButton}
          </Button>
        </div>
      </dialog>
    </>
  )
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
    { id: 'all', label: messages.exam.filterAll(count) },
    { id: 'wrong', label: messages.exam.filterWrong(count - score) },
  ]
  if (marked.size) filters.push({ id: 'marked', label: messages.exam.filterMarked(marked.size) })
  const { viewBox, center, strokeWidth, radius, circumference, excellentRate, passRate } = siteConfig.examRing
  const ringStroke = rate >= excellentRate ? cssVarRef('correct-badge') : rate >= passRate ? cssVarRef('selected-badge') : cssVarRef('wrong-badge')

  const backButton = <Button size="sm" onClick={onBack} disabled={busy}>{messages.common.back}</Button>
  const replayButton = (
    <Button variant="cta" size="sm" className="px-4" onClick={onRetry} disabled={busy} aria-busy={busy || undefined}>
      {busy ? messages.common.loadingGeneric : messages.exam.retakeSamePaper}
    </Button>
  )
  return (
    <div className="max-w-result mx-auto flex flex-col gap-6 animate-view-enter">
      <div className="flex items-center justify-between gap-3">
        {backButton}
        <h1 className="font-serif m-0 text-sub-title font-bold">{messages.exam.resultTitle}</h1>
        {replayButton}
      </div>

      <div className="flex flex-col items-center py-2">
        <div className="relative w-32 h-32 flex items-center justify-center">
          <svg className="w-full h-full -rotate-90" aria-hidden="true" viewBox={viewBox}>
            <circle cx={center} cy={center} r={radius} fill="none" stroke={cssVarRef('progress-track')} strokeWidth={strokeWidth} />
            <circle
              cx={center}
              cy={center}
              r={radius}
              fill="none"
              stroke={ringStroke}
              strokeWidth={strokeWidth}
              strokeLinecap="round"
              strokeDasharray={circumference}
              className="animate-ring-draw"
              style={{
                '--ring-circumference': String(circumference),
                '--ring-target': String(circumference * (1 - rate / 100)),
              } as CSSProperties & Record<'--ring-circumference' | '--ring-target', string>}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <output aria-label="考试得分" className={`tabular-nums text-3xl font-bold leading-none ${rate < passRate ? 'text-wrong-ink' : 'text-ink-primary'}`}>{score}</output>
            <span className="tabular-nums text-xs text-ink-muted mt-1">/ {count}</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2.5">
        <StatTile align="center" className="animate-option-in stagger-0" label={messages.common.accuracyStat} value={`${rate}%`} />
        <StatTile align="center" className="animate-option-in stagger-1" label={messages.common.durationStat} value={clock(elapsedSeconds(exam))} />
        <StatTile align="center" className="animate-option-in stagger-2" label={messages.common.wrongStat} value={count - score} valueClassName="text-wrong-ink" />
      </div>

      {local && unsubmitted.size > 0 && (
        <details className="p-4 rounded-option bg-missed-fill text-missed-ink text-xs">
          <summary className="cursor-pointer font-medium">{messages.exam.unsubmittedSummary(unsubmitted.size)}</summary>
          <ul className="m-0 mt-2 pl-4 flex flex-col gap-1">
            {exam.items.map((question, index) => unsubmitted.has(question.id) && (
              <li key={question.id}>{messages.exam.questionNumber(index)} · {answerLetters(question.options, local.draft.answers[question.id]) || messages.common.unanswered}</li>
            ))}
          </ul>
        </details>
      )}

      <div className="flex gap-2 flex-wrap">
        {filters.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            className={`tactile h-9 px-3.5 rounded-micro text-meta font-medium ${filter === id ? 'bg-cta text-cta-ink' : 'bg-surface text-ink-primary hover:bg-surface-hover'}`}
            aria-pressed={filter === id}
            onClick={() => setFilter(id)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-3.5">
        {exam.items.map((question, index) => {
          const isMarked = marked.has(question.id)
          if ((filter === 'wrong' && exam.correctness?.[question.id]) || (filter === 'marked' && !isMarked)) return null
          return <ExamResultItem key={question.id} exam={exam} question={question} index={index} marked={isMarked} />
        })}
      </div>
      <div className="flex items-center justify-between gap-3">{backButton}{replayButton}</div>
    </div>
  )
}

function ExamContent({ initialHistory }: { initialHistory?: ExamHistory | null }) {
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
  const list = useStudyData<ExamHistory>(exam ? null : siteConfig.api.exams, revision, { ...personalReads, initial: initialHistory })
  const activeDraft = foundDraft ?? list.data?.exams.find((entry) => entry.status === 'draft')
  const historyItems = list.data?.exams.filter((entry) => entry.status === 'submitted') ?? []

  function saveView(change: Partial<ExamView>) {
    preferences.save({ exam: { ...view, ...change } })
  }

  useEffect(() => {
    if (!selectedId || exam) return
    let active = true
    void requestJson<{ exam: ExamData }>(siteConfig.api.examById(selectedId), { headers: { [siteConfig.api.accountHeader]: userId } }).then(({ exam: restored }) => {
      if (active) setLoaded(restored)
    }, (cause: unknown) => {
      if (active) setRestoreError({ id: selectedId, message: cause instanceof StudyRequestError ? cause.message : messages.exam.restoreFailed })
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
        ? await requestJson(siteConfig.api.examById(id!), { headers: { [siteConfig.api.accountHeader]: userId } })
        : await writeJson(kind === 'replay' ? siteConfig.api.examReplay(id!) : siteConfig.api.exams, userId, 'POST',
          kind === 'new' ? { questionCount: requestedCount } : undefined)
      if (kind === 'new' && (response.reusedDraft || response.exam.items.length !== requestedCount)) {
        setFoundDraft({ ...response.exam, total: response.exam.items.length })
        setError(messages.exam.existingDraftError)
        refreshMe()
        return
      }
      setFoundDraft(undefined)
      setSubmittedElsewhere(false)
      setReplayNotice(kind === 'replay' && exam && response.exam.items.length < exam.items.length
        ? messages.exam.removedQuestionsNotice(response.exam.items.length) : '')
      setLoaded(response.exam)
      if (selectedId !== response.exam.id) saveView({
        screen: 'exam', id: response.exam.id, filter: 'all', fromHistory: kind === 'open' && view.screen === 'history',
      })
      if (kind !== 'open') refreshMe()
      window.scrollTo(0, 0)
    } catch (cause) {
      setError(cause instanceof StudyRequestError ? cause.message : messages.exam.loadPaperFailed)
    } finally { loadingNow.current = false; setBusy(false) }
  }

  function returnFromExam() {
    saveView({ screen: view.screen === 'exam' && view.fromHistory ? 'history' : 'entrance', id: null, fromHistory: false })
    setError('')
    setRestoreError(undefined)
    window.scrollTo(0, 0)
  }

  if (exam?.status === 'draft') {
    return (
      <>
        {error && <p className="mb-3 text-meta text-wrong-ink" role="alert">{error}</p>}
        {replayNotice && <p className="m-0 text-meta text-ink-secondary" role="status">{replayNotice}</p>}
        <ExamTaking
          key={`${exam.id}:${exam.revision}`}
          exam={exam}
          onReload={() => void load('open', exam.id)}
          onResult={(result, elsewhere) => {
            setSubmittedElsewhere(elsewhere)
            setLoaded(result)
            saveView({ screen: 'exam', id: result.id, filter: 'all' })
            refreshMe()
            window.scrollTo(0, 0)
          }}
        />
      </>
    )
  }

  if (exam?.status === 'submitted') {
    return (
      <>
        {error && <p className="mb-3 text-meta text-wrong-ink" role="alert">{error}</p>}
        {submittedElsewhere && <p className="mb-3 text-meta text-ink-secondary" role="status">{messages.exam.submittedElsewhereNotice}</p>}
        <ExamResult
          key={exam.id}
          exam={exam}
          onBack={returnFromExam}
          onRetry={() => void load('replay', exam.id)}
          busy={busy}
          filter={view.filter}
          setFilter={(filter) => saveView({ filter })}
        />
      </>
    )
  }

  if (selectedId) {
    return (
      <section className="max-w-exam mx-auto">
        <Button variant="surface" size="sm" className="mb-4" onClick={returnFromExam}>{messages.common.back}</Button>
        <LoadMessage
          loading={restoreError?.id !== selectedId}
          error={restoreError?.id === selectedId ? restoreError.message : null}
          retry={() => { setRestoreError(undefined); setRestoreAttempt((count) => count + 1) }}
        />
      </section>
    )
  }

  if (view.screen === 'history') {
    return (
      <section className="max-w-history mx-auto flex flex-col gap-4 animate-view-enter" aria-labelledby="exam-history">
        <div className="flex items-center gap-3">
          <Button variant="surface" size="sm" onClick={returnFromExam}>{messages.common.back}</Button>
          <h1 id="exam-history" className="font-serif m-0 text-sub-title font-bold">{messages.exam.historyTitle}</h1>
        </div>
        {error && <p className="m-0 text-meta text-wrong-ink" role="alert">{error}</p>}
        {historyItems.length === 0 ? (
          <LoadMessage loading={list.loading} error={list.error} retry={list.retry} empty={messages.exam.noHistory} />
        ) : (
          <div className="flex flex-col gap-2.5">
            {historyItems.map((item) => (
              <button
                key={item.id}
                type="button"
                className="btn-surface p-4 rounded-option flex items-center justify-between gap-3 text-left"
                disabled={busy}
                onClick={() => void load('open', item.id)}
              >
                <div>
                  <div className="text-body font-semibold tabular-nums">{examDate(item)}</div>
                  <div className="mt-1 text-xs text-ink-secondary tabular-nums">{messages.exam.durationLabel(clock(elapsedSeconds(item)))}</div>
                </div>
                <span className="tabular-nums px-3 py-1.5 rounded-micro text-sm font-semibold bg-correct-fill text-correct-ink shrink-0">
                  {messages.exam.scoreFraction(item.score, item.total ?? DEFAULT_EXAM_QUESTIONS)}
                </span>
              </button>
            ))}
          </div>
        )}
      </section>
    )
  }

  return (
    <section className="max-w-exam mx-auto w-full min-h-[min(66svh,580px)] lg:min-h-[min(68vh,680px)] flex flex-col items-center justify-evenly gap-9 py-5 lg:gap-12 lg:py-8 text-center animate-view-enter" aria-labelledby="exam-title">
      <div>
        <div className="flex justify-center items-center gap-2.5 mb-4">
          <Image src={siteConfig.assets.crest} alt="" width={siteConfig.imageDimensions.examBadgeCrest} height={siteConfig.imageDimensions.examBadgeCrest} className="rounded-full bg-white object-contain" unoptimized />
          {messages.exam.badges.map((badge) => (
            <Badge key={badge}>{badge}</Badge>
          ))}
        </div>
        <h1 id="exam-title" className="font-serif m-0 text-hero-title font-bold">{messages.exam.heroTitle}</h1>
        <p className="m-0 mt-3 text-body text-ink-secondary">{messages.exam.heroSubtitle}</p>
      </div>

      {activeDraft ? (
        <div className="px-6 py-5 rounded-option bg-surface flex flex-col gap-5">
          <p className="m-0 text-sm text-ink-secondary">{messages.exam.existingDraftPrompt}</p>
          <Button
            variant="cta"
            size="lg"
            className="px-6 self-center"
            disabled={busy}
            aria-busy={busy || undefined}
            onClick={() => void load('open', activeDraft.id)}
          >
            {busy ? messages.exam.loadingPaper : messages.exam.resumeDraftButton(activeDraft.total ?? DEFAULT_EXAM_QUESTIONS)}
          </Button>
        </div>
      ) : list.data ? (
        <form
          className="w-full flex flex-col items-center gap-8 lg:gap-10"
          onSubmit={(event) => {
            event.preventDefault()
            if (isExamQuestionCount(Number(questionCount))) void load('new')
          }}
        >
          <div>
            <label htmlFor="exam-question-count" className="block text-meta font-medium text-ink-secondary mb-4">
              {messages.exam.questionCountLabel(MIN_EXAM_QUESTIONS, MAX_EXAM_QUESTIONS)}
            </label>
            <div className="flex justify-center items-center gap-2 flex-wrap">
              {siteConfig.examQuickCounts.map((preset) => {
                const active = Number(questionCount) === preset
                return (
                  <Button
                    key={preset}
                    variant={active ? 'selected' : 'surface'}
                    size="md"
                    aria-pressed={active}
                    disabled={busy}
                    className="h-10 text-sm tabular-nums"
                    onClick={() => {
                      setCountEdit(String(preset))
                      saveView({ count: preset })
                    }}
                  >
                    {messages.common.questionCount(preset)}
                  </Button>
                )
              })}
              <TextInput
                id="exam-question-count"
                type="number"
                inputMode="numeric"
                className="max-w-24 h-10 tabular-nums text-center"
                min={MIN_EXAM_QUESTIONS}
                max={MAX_EXAM_QUESTIONS}
                step={1}
                required
                value={questionCount}
                disabled={busy}
                onChange={(event) => {
                  setCountEdit(event.target.value)
                  const count = Number(event.target.value)
                  if (isExamQuestionCount(count)) saveView({ count })
                }}
              />
            </div>
          </div>

          <Button type="submit" variant="cta" size="lg" className="px-7 self-center" aria-busy={busy || undefined}
            disabled={busy || !isExamQuestionCount(Number(questionCount))}>
            {busy ? messages.exam.generatingPaper : messages.exam.startExamButton}
          </Button>
        </form>
      ) : list.loading ? (
        <p className="m-0 text-sm text-ink-muted" role="status">{messages.common.loading}</p>
      ) : null}

      <Button size="md" onClick={() => saveView({ screen: 'history' })}>
        {messages.exam.historyButton(historyItems.length)}
      </Button>
      {list.error && (
        <div className="text-meta text-wrong-ink flex items-center gap-2" role="alert">
          <span>{messages.exam.draftLoadError}</span>
          <Button variant="surface" size="xs" onClick={list.retry}>{messages.common.retry}</Button>
        </div>
      )}
      {error && <p className="m-0 text-meta text-wrong-ink" role="alert">{error}</p>}
    </section>
  )
}

export function Exam({ initialHistory }: { initialHistory?: ExamHistory | null }) {
  const { preferences } = useStudySessionContext()
  return preferences.ready ? <ExamContent initialHistory={initialHistory} /> : <LoadMessage loading />
}
