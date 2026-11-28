'use client'

import { type FormEvent, type MouseEventHandler, useEffect, useRef, useState } from 'react'
import { MailboxIcon } from '@/components/icons'
import { ActionLink, Button, TextArea, UnreadDot } from '@/components/ui'
import { messages } from '@/config/messages'
import { siteConfig } from '@/config/site'
import { authorChatHash, unreadDescriptionId } from '@/features/chat/types'
import { useTabDraft } from '@/use-tab-draft'
import { requestJson, StudyRequestError } from './api'
import { feedbackMaxLength, feedbackRatings } from './feedback'

export { MailboxIcon }

type FeedbackDraft = { rating: typeof feedbackRatings[number] | ''; message: string }
const emptyDraft: FeedbackDraft = { rating: '', message: '' }

function readFeedbackDraft(value: unknown): FeedbackDraft | null {
  const draft = value as Partial<FeedbackDraft> | null
  if (typeof draft?.message !== 'string') return null
  return { rating: feedbackRatings.find((rating) => rating === draft.rating) ?? '', message: draft.message.slice(0, feedbackMaxLength) }
}

export function FeedbackPage({ pathname, userId, active, unread, onBack, warmAuthorChat, onOpenAuthorChat }: {
  pathname: string
  userId: string
  active: boolean
  unread: boolean
  onBack: MouseEventHandler<HTMLAnchorElement>
  warmAuthorChat: () => void
  onOpenAuthorChat: MouseEventHandler<HTMLAnchorElement>
}) {
  const page = useRef<HTMLElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const { value, snapshot, save, clear } = useTabDraft(siteConfig.storageKeys.feedbackDraft(userId), readFeedbackDraft)
  const draft = value ?? emptyDraft
  const { rating, message } = draft
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent'>('idle')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!active) return
    heading.current?.focus({ preventScroll: true })
    page.current?.scrollIntoView({ block: 'start' })
  }, [active])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (status !== 'idle') return
    const content = message.trim()
    if (!rating) {
      setError(messages.feedback.pickRatingError)
      return
    }

    setError('')
    setStatus('sending')
    try {
      await requestJson(siteConfig.api.feedback, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', [siteConfig.api.accountHeader]: userId },
        body: JSON.stringify({ rating, message: content }),
        signal: AbortSignal.timeout(siteConfig.timings.feedbackTimeoutMs),
      })
      clear(snapshot)
      setStatus('sent')
    } catch (failure) {
      setError(failure instanceof StudyRequestError ? failure.message : messages.feedback.submitFallbackError)
      setStatus('idle')
    }
  }

  return (
    <section ref={page} className="max-w-feedback mx-auto py-2 animate-view-enter" aria-labelledby="feedback-title">
      <ActionLink variant="surface" size="sm" className="mb-5" href={pathname} onClick={onBack}>
        {messages.common.backToPractice}
      </ActionLink>

      <div className="flex items-start justify-between gap-3 flex-wrap mb-6">
        <div className="flex items-center gap-2.5">
          <MailboxIcon size={siteConfig.limits.mailboxHeaderSize} />
          <h1 id="feedback-title" ref={heading} tabIndex={-1} className="font-serif m-0 text-page-title font-bold outline-none">
            {messages.feedback.title}
          </h1>
        </div>
        <ActionLink
          variant="surface"
          size="md"
          className="relative"
          href={authorChatHash}
          aria-describedby={unread ? unreadDescriptionId : undefined}
          onPointerEnter={warmAuthorChat}
          onPointerDown={warmAuthorChat}
          onFocus={warmAuthorChat}
          onClick={onOpenAuthorChat}
        >
          {messages.feedback.authorChat}
          {unread && <UnreadDot />}
        </ActionLink>
      </div>

      <p className="text-control text-ink-secondary">
        紧急情况请联系 QQ 邮箱：<a className="underline" href={`mailto:${siteConfig.feedbackEmail}`}>{siteConfig.feedbackEmail}</a>
      </p>

      {status === 'sent' ? (
        <div className="p-6 rounded-option bg-correct-fill text-correct-ink" role="status">
          <p className="m-0 text-action font-semibold">{messages.feedback.sentTitle}</p>
          <p className="m-0 mt-1.5 text-control">{messages.feedback.sentSubtitle}</p>
          <Button variant="surface" size="sm" className="mt-4" onClick={() => setStatus('idle')}>
            {messages.feedback.writeAnother}
          </Button>
        </div>
      ) : (
        <form className="flex flex-col gap-5" onSubmit={(event) => void submit(event)}>
          <div>
            <div className="text-xs font-medium text-ink-muted mb-2.5">{messages.feedback.ratingLabel}</div>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={messages.feedback.ratingLabel}>
              {feedbackRatings.map((option) => {
                const activeOption = rating === option
                return (
                  <Button
                    key={option}
                    variant={activeOption ? 'selected' : 'surface'}
                    size="md"
                    role="radio"
                    aria-checked={activeOption}
                    className="h-10 text-control"
                    onClick={() => {
                      setError('')
                      save({ ...draft, rating: option })
                    }}
                  >
                    {option}
                  </Button>
                )
              })}
            </div>
          </div>

          <div>
            <label htmlFor="feedback-message" className="block text-xs font-medium text-ink-muted mb-2.5">
              {messages.feedback.messageLabel(message.length, feedbackMaxLength)}
            </label>
            <TextArea
              id="feedback-message"
              maxLength={feedbackMaxLength}
              placeholder={messages.feedback.messagePlaceholder}
              value={message}
              onChange={(event) => save({ ...draft, message: event.target.value })}
            />
          </div>

          {error && <p className="m-0 text-meta text-wrong-ink" role="alert">{error}</p>}

          <Button type="submit" variant="cta" size="lg" className="w-full" disabled={status === 'sending'}>
            {status === 'sending' ? messages.feedback.submitting : messages.feedback.submitButton}
          </Button>
        </form>
      )}
    </section>
  )
}
