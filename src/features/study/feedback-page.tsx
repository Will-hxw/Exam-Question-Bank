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
    <section ref={page} className="max-w-feedback w-full mx-auto py-2 flex flex-1 flex-col animate-view-enter" aria-labelledby="feedback-title">
      <ActionLink variant="surface" size="sm" className="mb-5 self-start" href={pathname} onClick={onBack}>
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

      <p className="m-0 mb-7 text-control text-ink-secondary">
        紧急情况请联系 QQ 邮箱：<a className="text-ink-secondary underline underline-offset-2 hover:text-ink-primary" href={`mailto:${siteConfig.feedbackEmail}`}>{siteConfig.feedbackEmail}</a>
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
        <form className="flex flex-1 flex-col gap-5" onSubmit={(event) => void submit(event)}>
          <fieldset className="m-0 min-w-0 p-0 border-0" disabled={status === 'sending'}>
            <legend className="text-body font-medium text-ink-primary">{messages.feedback.ratingLabel}</legend>
            <div className="relative isolate mt-3 grid grid-cols-5">
              <span aria-hidden="true" className="absolute top-4 left-1/10 right-1/10 h-px bg-progress-track" />
              {feedbackRatings.map((option) => (
                <label key={option} className="relative flex min-h-12 cursor-pointer flex-col items-center gap-1.5 py-2 text-meta text-ink-secondary">
                  <input type="radio" name="rating" value={option} checked={rating === option} required
                    className="m-0 h-4 w-4 accent-[var(--selected-badge)]"
                    onChange={() => { setError(''); save({ ...draft, rating: option }) }} />
                  <span lang={option === 'NPC' ? 'en' : undefined} className={rating === option ? 'font-semibold text-ink-primary' : ''}>{option}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="flex flex-1 flex-col">
            <label htmlFor="feedback-message" className="block mb-2.5 text-body font-medium text-ink-primary">
              {messages.feedback.messageLabel}<span className="ml-2 text-xs font-normal text-ink-secondary">选填</span>
            </label>
            <TextArea id="feedback-message" name="message" rows={8} className="block flex-1" maxLength={feedbackMaxLength}
              placeholder={messages.feedback.messagePlaceholder} value={message} readOnly={status === 'sending'}
              onChange={(event) => save({ ...draft, message: event.target.value })} />
          </div>

          {error && <p className="m-0 text-meta text-wrong-ink" role="alert">{error}</p>}

          <div className="mt-auto flex items-center justify-between gap-3">
            <span className="text-meta tabular-nums text-ink-secondary">{message.length} / {feedbackMaxLength}</span>
            <Button type="submit" variant="cta" size="lg" className="px-7" disabled={status === 'sending'} aria-busy={status === 'sending'}>
              {status === 'sending' ? messages.feedback.submitting : messages.feedback.submitButton}
            </Button>
          </div>
        </form>
      )}
    </section>
  )
}
