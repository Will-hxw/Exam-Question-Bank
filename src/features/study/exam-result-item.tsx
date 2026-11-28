import { useState } from 'react'
import { Badge, CollapsePanel } from '@/components/ui'
import { messages } from '@/config/messages'
import { answerLetters, letter, type Question } from './api'
import { ExplanationPanel } from './controls'
import type { Exam as ExamData } from './exam-draft'

export function ExamResultItem({ exam, question, index, marked }: { exam: ExamData; question: Question; index: number; marked: boolean }) {
  const [expanded, setExpanded] = useState(false)
  const correct = Boolean(exam.correctness?.[question.id])
  const answerIds = question.answerIds ?? []
  const selected = exam.answers[question.id] ?? []

  return (
    <article className="p-4.5 lg:p-5 rounded-option bg-surface flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Badge tone={correct ? 'correct' : 'wrong'} className="font-semibold animate-badge-pop">
            {correct ? messages.common.correct : messages.common.wrong}
          </Badge>
          <span className="tabular-nums text-xs font-medium text-ink-muted">{messages.exam.questionNumber(index)}</span>
          <Badge tone="canvas">{question.type === 'single' ? messages.common.singleChoice : messages.common.multipleChoice}</Badge>
        </div>
        {marked && <Badge tone="missed" size="status">{messages.exam.marked}</Badge>}
      </div>

      <p className="font-serif m-0 text-item-stem font-semibold text-ink-primary">{question.stem}</p>

      <div className="flex flex-col gap-1.5">
        {question.options.map((option, i) => {
          const isAns = answerIds.includes(option.id)
          const isChosen = selected.includes(option.id)
          let cls = 'bg-canvas text-ink-body'
          let tag = ''
          if (isChosen && isAns) cls = 'bg-correct-fill text-correct-ink font-medium'
          else if (isChosen && !isAns) cls = 'bg-wrong-fill text-wrong-ink font-medium'
          else if (!isChosen && isAns) {
            cls = 'bg-missed-fill text-missed-ink font-medium'
            tag = messages.common.missed
          }
          return (
            <div key={option.id} className={`px-3 py-2 rounded-micro text-sm flex items-center justify-between gap-2 ${cls}`}>
              <span><strong className="mr-2 tabular-nums">{letter(i)}</strong>{option.text}</span>
              {tag && <span className="missed-tag">{tag}</span>}
            </div>
          )
        })}
      </div>

      {!correct && (
        <div className="flex items-baseline gap-5 flex-wrap text-meta">
          <span className="text-ink-secondary">{messages.common.correctAnswer} <strong className="text-correct-ink tabular-nums ml-1">{answerLetters(question.options, answerIds)}</strong></span>
          <span className="text-ink-secondary">{messages.common.yourChoice} <strong className="text-wrong-ink tabular-nums ml-1">{answerLetters(question.options, selected) || messages.common.unanswered}</strong></span>
        </div>
      )}

      {question.explanation && (
        <div>
          <button
            type="button"
            className="tactile h-8.5 px-3.5 rounded-micro text-meta font-medium bg-canvas text-ink-primary"
            onClick={() => setExpanded(!expanded)}
            aria-expanded={expanded}
          >
            {expanded ? messages.common.collapseExplanation : messages.common.expandExplanation}
          </button>
          <CollapsePanel open={expanded}>
            <div className="mt-3">
              <ExplanationPanel content={{ answerIds, explanation: question.explanation, options: question.options, sources: question.sources ?? [] }} hideHeading />
            </div>
          </CollapsePanel>
        </div>
      )}
    </article>
  )
}
