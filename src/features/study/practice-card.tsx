'use client'

import { type TouchEvent, useEffect, useEffectEvent, useRef, useState } from 'react'
import { BookmarkIcon, CheckIcon, CrossIcon } from '@/components/icons'
import { Badge, Button, OptionCard, type OptionCardState, ProgressBar } from '@/components/ui'
import { messages } from '@/config/messages'
import { siteConfig } from '@/config/site'
import { answerLetters, letter, type Question } from './api'
import { ExplanationPanel } from './explanation-panel'
import { useQuestionFavorite, useStudySessionContext } from './study-shell'

export type PracticeAnswer = { ids: string[]; correct: boolean; eventId: string | null }

export function PracticeCard({
  question,
  answer,
  record,
  resetRecord,
  mode,
  index,
  total,
  fallback,
  previous,
  next,
  attempted,
  favorite,
  wrongMode,
  onRemoved,
  onOpenSheet,
  direction = 'jump',
}: {
  question: Question
  answer: PracticeAnswer | undefined
  record: (answer: PracticeAnswer) => void
  resetRecord: () => void
  mode: typeof siteConfig.practiceModes[number]['id']
  index: number
  total: number
  fallback: string
  previous: (() => void) | null
  next: (() => void) | null
  attempted: boolean
  favorite: boolean | undefined
  wrongMode: boolean
  onRemoved: () => void
  onOpenSheet: () => void
  direction?: 'forward' | 'backward' | 'jump'
}) {
  const { attempts, removeWrong } = useStudySessionContext()
  const favoriteControl = useQuestionFavorite(question.id, favorite)
  const [selection, setSelection] = useState<string[]>([])
  const article = useRef<HTMLElement>(null)
  const swipe = useRef<{ id: number; x: number; y: number } | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [message, setMessage] = useState('')
  const [removing, setRemoving] = useState(false)
  const submittedAnswer = useRef(answer)
  const selected = answer?.ids ?? selection
  const immediate = question.type === 'single'
  const canExplain = Boolean(answer?.eventId || (!wrongMode && attempted))
  const ordered = mode === 'topic' || mode === 'sequence'
  const pct = total > 0 ? Math.max(siteConfig.examRing.minProgressPct, Math.min(100, ((index + 1) / total) * 100)) : 0

  function saveAnswer(ids: string[], correct: boolean) {
    if (submittedAnswer.current?.eventId) return true
    const eventId = attempts.enqueue(question.id, ids, question.contentRevision)
    const result = { ids, correct, eventId }
    submittedAnswer.current = result
    record(result)
    setMessage(eventId ? '' : messages.practice.saveLocalError)
    return Boolean(eventId)
  }

  function submit(ids = selection) {
    if (submittedAnswer.current) return
    if (!ids.length) { setMessage(messages.practice.pickAnswerPrompt); return }
    if (!question.answerIds?.length) { setMessage(messages.practice.answerUnavailable); return }
    const correct = ids.length === question.answerIds.length && ids.every((id) => question.answerIds?.includes(id))
    if (saveAnswer(ids, correct)) setExpanded(!correct)
  }

  function redoCurrent() {
    submittedAnswer.current = undefined
    setSelection([])
    setMessage('')
    setExpanded(false)
    resetRecord()
  }

  async function clearWrong() {
    setRemoving(true)
    try {
      await removeWrong(question.id)
      onRemoved()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : messages.practice.removeWrongError)
    } finally {
      setRemoving(false)
    }
  }

  function selectOption(id: string) {
    if (submittedAnswer.current) return
    if (immediate) { submit([id]); return }
    setMessage('')
    setSelection((before) => before.includes(id) ? before.filter((value) => value !== id) : [...before, id])
  }

  function startSwipe(event: TouchEvent<HTMLElement>) {
    swipe.current = null
    const point = event.touches[0]
    if (event.touches.length !== 1 || point.clientX < 32 || point.clientX > window.innerWidth - 32) return
    const target = event.target
    if (target instanceof Element && target.closest('a,button,input,textarea,select')
      && !target.closest('[role="group"]')) return
    swipe.current = { id: point.identifier, x: point.clientX, y: point.clientY }
  }

  function trackSwipe(event: TouchEvent<HTMLElement>) {
    const start = swipe.current
    if (!start) return
    const point = event.touches[0]
    const dy = Math.abs(point.clientY - start.y)
    if (event.touches.length !== 1 || (dy > 12 && dy >= Math.abs(point.clientX - start.x))) swipe.current = null
  }

  function endSwipe(event: TouchEvent<HTMLElement>) {
    const start = swipe.current
    swipe.current = null
    const point = event.changedTouches[0]
    if (!start || event.touches.length || point.identifier !== start.id) return
    const dx = point.clientX - start.x
    if (Math.abs(dx) < 60 || Math.abs(dx) < 1.5 * Math.abs(point.clientY - start.y)) return
    // Suppress the compatibility click if the drag began on an answer option.
    event.preventDefault()
    if (dx < 0) next?.()
    else previous?.()
  }

  const handleKey = useEffectEvent((event: KeyboardEvent) => {
    const card = article.current
    const target = event.target
    if (!card || document.hidden || card.closest('[hidden],[inert]') || !card.getClientRects().length
      || document.querySelector('dialog[open],[role="dialog"][aria-modal="true"],.drawer-overlay[aria-hidden="false"]')
      || event.defaultPrevented || event.isComposing || event.repeat || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
    if (target instanceof Element) {
      if (target.closest('input,textarea,select,a,[contenteditable]:not([contenteditable="false"])')) return
      if (target !== document.body && target !== document.documentElement && !card.contains(target)) return
      if (event.key === 'Enter' && target.closest('button,[role="button"]')) return
    }
    const option = /^[1-6]$/.test(event.key) ? question.options[Number(event.key) - 1] : undefined
    if (option && !submittedAnswer.current) selectOption(option.id)
    else if (event.key === 'ArrowLeft' && previous) previous()
    else if (event.key === 'ArrowRight' && next) next()
    else if (event.key === 'Enter' && !submittedAnswer.current && selection.length) submit()
    else if (event.key === 'Enter' && submittedAnswer.current && next) next()
    else return
    event.preventDefault()
  })
  useEffect(() => {
    const listener = (event: KeyboardEvent) => handleKey(event)
    document.addEventListener('keydown', listener)
    return () => document.removeEventListener('keydown', listener)
  }, [])

  const explanation = question.answerIds && question.explanation ? {
    answerIds: question.answerIds, explanation: question.explanation, options: question.options, sources: question.sources ?? [],
  } : null

  const enterAnim = direction === 'forward' ? 'animate-slide-next' : direction === 'backward' ? 'animate-slide-prev' : 'animate-question-enter'

  const confirm = !answer && (
    <Button variant="cta" size="lg" className="flex-1 !px-2 !text-sm lg:!px-5 lg:!text-action" disabled={!selected.length} onClick={() => submit()}>
      {messages.common.submitConfirm}
    </Button>
  )
  const nextButton = (
    <Button variant={answer ? 'cta' : 'surface'} size="lg" className="flex-1 !px-2 !text-sm lg:!px-5 lg:!text-action" disabled={!next} onClick={next ?? undefined}>
      {messages.common.nextQuestion}
    </Button>
  )
  return (
    <>
      <article ref={article} aria-label={messages.practice.articleAria} className={enterAnim}
        onTouchStart={startSwipe} onTouchMove={trackSwipe} onTouchEnd={endSwipe} onTouchCancel={() => { swipe.current = null }}>
        {/* Question metadata & favorite */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 flex-wrap">
            <Badge>{question.type === 'single' ? messages.common.singleChoice : messages.common.multipleChoice}</Badge>
            <span className="tabular-nums text-meta font-medium text-ink-secondary">
              {ordered && total > 0 ? `${index + 1} / ${total}` : fallback}
            </span>
            {ordered && total > 0 && <ProgressBar percent={pct} />}
            {(answer || attempted) && (
              <Badge tone="correct" size="status" className="animate-badge-pop">{messages.common.answeredShort}</Badge>
            )}
          </div>

          <div className="inline-flex items-center gap-2 shrink-0">
            {!canExplain && <Button variant="surface" size="sm" disabled title="作答后可展开解析">
              {messages.common.expandExplanation}
            </Button>}
            <button
              type="button"
              className={`tactile w-9 h-9 rounded-micro flex items-center justify-center shrink-0 ${favoriteControl.favorite ? 'bg-missed-fill text-missed-badge animate-bookmark-pop' : 'bg-surface text-ink-secondary hover:bg-surface-hover'}`}
              aria-pressed={favoriteControl.favorite}
              aria-busy={favoriteControl.pending || undefined}
              aria-label={favoriteControl.favorite ? messages.common.unfavoriteQuestion : messages.common.favoriteQuestion}
              onClick={favoriteControl.toggle}
            >
              <BookmarkIcon filled={favoriteControl.favorite} />
            </button>
          </div>
        </div>

        {/* Stem */}
        <h1 className="font-serif mt-4 mb-6 text-stem lg:text-stem-lg font-semibold text-ink-primary">
          {question.stem}
        </h1>

        {/* Options stack (6-state matrix) */}
        <div className="flex flex-col gap-3" role="group" aria-label={messages.practice.optionsAria}>
          {question.options.map((option, optIndex) => {
            const chosen = selected.includes(option.id)
            const isCorrect = Boolean(question.answerIds?.includes(option.id))

            let state: OptionCardState = 'idle'
            let indicator: React.ReactNode = null

            if (!answer) {
              if (chosen) state = 'selected'
            } else if (chosen && isCorrect) {
              state = 'correct'
              indicator = (
                <span className="text-correct-badge flex shrink-0" aria-label={messages.common.correctShort}>
                  <CheckIcon animated />
                </span>
              )
            } else if (chosen && !isCorrect) {
              state = 'wrong'
              indicator = (
                <span className="text-wrong-badge flex shrink-0" aria-label={messages.common.wrongShort}>
                  <CrossIcon />
                </span>
              )
            } else if (!chosen && isCorrect) {
              state = 'missed'
              indicator = (
                <span className="missed-tag animate-badge-pop">
                  {messages.common.missed}
                </span>
              )
            } else {
              state = 'muted'
            }

            return (
              <OptionCard
                key={option.id}
                letter={letter(optIndex)}
                text={option.text}
                state={state}
                staggerIndex={optIndex}
                indicator={indicator}
                pressed={chosen}
                disabled={Boolean(answer)}
                onClick={() => selectOption(option.id)}
              />
            )
          })}
        </div>

        {/* Wrong & favorite error messages */}
        {favoriteControl.error && <p className="mt-3 text-meta text-wrong-ink" role="alert">{favoriteControl.error}</p>}
        {message && <p className="mt-3 text-meta text-wrong-ink" role="alert">{message}</p>}

        {wrongMode && (
          <Button variant="surface" size="sm" className="mt-3" disabled={removing} onClick={() => void clearWrong()}>
            {messages.common.removeFromWrong}
          </Button>
        )}

        {/* Feedback & explanation section */}
        {(answer || (canExplain && explanation)) && (
          <section className="mt-7 animate-feedback-bloom" role="status">
            {answer && (
              <>
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <span className={`${answer.correct ? 'status-pill-correct' : 'status-pill-wrong'} animate-badge-pop`}>
                    {answer.correct ? messages.practice.answeredCorrectly : messages.practice.answeredWrong}
                  </span>
                  <div className="flex items-center gap-2">
                    <Button variant="surface" size="sm" className="h-auto py-1.5" onClick={redoCurrent}>
                      {messages.practice.redoQuestion}
                    </Button>
                  </div>
                </div>

                <div className="mt-3.5 flex items-baseline gap-6 flex-wrap">
                  <div className="flex items-baseline gap-2">
                    <span className="text-meta text-ink-secondary">{messages.common.correctAnswer}</span>
                    <span className="tabular-nums text-action font-semibold text-correct-ink">
                      {answerLetters(question.options, question.answerIds ?? [])}
                    </span>
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-meta text-ink-secondary">{messages.common.yourChoice}</span>
                    <span className={`tabular-nums text-action font-semibold ${answer.correct ? 'text-correct-ink' : 'text-wrong-ink'}`}>
                      {answerLetters(question.options, answer.ids) || messages.common.unselected}
                    </span>
                  </div>
                </div>

                {!answer.eventId && (
                  <Button variant="surface" size="sm" className="mt-3 text-xs" onClick={() => saveAnswer(answer.ids, answer.correct)}>
                    {messages.practice.retrySaveQuestion}
                  </Button>
                )}
              </>
            )}

            {canExplain && explanation && (
              <div className="mt-6">
                <div className="flex items-center justify-between">
                  <h2 className="font-serif m-0 text-base font-bold text-ink-primary">{messages.practice.explanationHeading}</h2>
                  <button
                    type="button"
                    className="tactile px-2.5 py-1 rounded-tag text-meta font-medium text-ink-secondary hover:bg-surface"
                    aria-expanded={expanded}
                    onClick={() => setExpanded((prev) => !prev)}
                  >
                    {expanded ? messages.common.collapseExplanation : messages.common.expandExplanation}
                  </button>
                </div>
                {expanded && (
                  <div className="mt-2.5">
                    {!answer && <p className="mb-2">{messages.common.correctAnswer}：{answerLetters(explanation.options, explanation.answerIds)}</p>}
                    <ExplanationPanel content={explanation} hideHeading />
                  </div>
                )}
              </div>
            )}
          </section>
        )}

        {/* Desktop action bar */}
        <div className="hidden lg:flex items-center gap-2.5 mt-7">
          <Button variant="surface" size="lg" className="px-4.5 text-sm" disabled={!previous} onClick={previous ?? undefined}>
            {messages.common.previousQuestion}
          </Button>
          {confirm}
          {nextButton}
          <span className="text-xs text-ink-muted ml-1.5">{siteConfig.shortcutsHint}</span>
        </div>
      </article>

      {/* Mobile question actions */}
      <footer className="glass-footer lg:hidden !gap-1.5">
        {confirm}
        <Button variant="surface" size="lg" className="!px-2 !text-sm shrink-0" disabled={!previous} onClick={previous ?? undefined}>
          {messages.common.previousQuestion}
        </Button>
        {nextButton}
        <Button variant="surface" size="lg" className="!px-2 !text-sm shrink-0" aria-haspopup="dialog" onClick={(event) => {
          event.currentTarget.focus({ preventScroll: true })
          onOpenSheet()
        }}>
          {messages.practice.answerSheet}
        </Button>
      </footer>
    </>
  )
}
