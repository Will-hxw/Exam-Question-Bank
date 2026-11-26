'use client'

import { type FormEvent, type MouseEventHandler, useEffect, useRef, useState } from 'react'
import { authorChatHash, unreadDescriptionId } from '@/features/chat/types'
import { useTabDraft } from '@/use-tab-draft'
import { requestJson, StudyRequestError } from './api'
import { feedbackMaxLength, feedbackRatings } from './feedback'

type FeedbackDraft = { rating: typeof feedbackRatings[number] | ''; message: string }
const emptyDraft: FeedbackDraft = { rating: '', message: '' }

function readFeedbackDraft(value: unknown): FeedbackDraft | null {
  const draft = value as Partial<FeedbackDraft> | null
  if (typeof draft?.message !== 'string') return null
  return { rating: feedbackRatings.find((rating) => rating === draft.rating) ?? '', message: draft.message.slice(0, feedbackMaxLength) }
}

export function MailboxIcon({ size = 20 }: { size?: number }) {
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 20v-7a6 6 0 0 1 6-6h6a6 6 0 0 1 6 6v7H3Z" />
    <path d="M9 7a6 6 0 0 1 6 6v7M6.5 14h5M17 7V3h4" />
  </svg>
}

export function FeedbackPage({ pathname, userId, active, unread, onBack, warmAuthorChat, onOpenAuthorChat }: {
  pathname: string
  userId: string
  active: boolean
  unread: boolean
  onBack: MouseEventHandler<HTMLAnchorElement>
  warmAuthorChat: () => void
  onOpenAuthorChat: () => void
}) {
  const page = useRef<HTMLElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const { value, snapshot, save, clear } = useTabDraft(`cqu-feedback-draft:${userId}`, readFeedbackDraft)
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
      setError('请选择一档评价。')
      return
    }

    setError('')
    setStatus('sending')
    try {
      await requestJson('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Study-Account': userId },
        body: JSON.stringify({ rating, message: content }),
        signal: AbortSignal.timeout(20_000),
      })
      clear(snapshot)
      setStatus('sent')
    } catch (failure) {
      setError(failure instanceof StudyRequestError ? failure.message : '提交未获确认，请检查网络后再试。')
      setStatus('idle')
    }
  }

  return <section ref={page} className="feedback-page" aria-labelledby="feedback-title">
    <a className="feedback-back" href={pathname} onClick={onBack}>← 返回练习</a>
    <div className="feedback-content">
      <header className="feedback-heading">
        <div className="feedback-title-row">
          <MailboxIcon size={24} />
          <h1 ref={heading} id="feedback-title" tabIndex={-1}>意见反馈</h1>
          <a className="feedback-chat-link" href={authorChatHash} aria-label="作者对话" title="作者对话"
            aria-describedby={unread ? unreadDescriptionId : undefined}
            onPointerEnter={warmAuthorChat} onPointerDown={warmAuthorChat} onFocus={warmAuthorChat}
            onClick={onOpenAuthorChat}>
            <svg aria-hidden="true" width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20.5 11.5a7.5 7.5 0 0 1-7.5 7.5H9l-4 2 .7-3.3a7.5 7.5 0 0 1 4.8-13.7H13a7.5 7.5 0 0 1 7.5 7.5Z" />
              <path d="M8.5 10h7m-7 3.3h4.7" />
            </svg>
            {unread && <span className="message-unread-dot" aria-hidden="true" />}
          </a>
        </div>
        <p className="feedback-contact">
          紧急情况请联系 <span lang="en">QQ</span> 邮箱：<a href="mailto:1176843521@qq.com">1176843521@qq.com</a>
        </p>
      </header>
      {status !== 'sent' && (
        <form className="feedback-form" onSubmit={submit}>
          <fieldset className="feedback-rating" disabled={status === 'sending'}>
            <legend>你觉得练习站怎么样？</legend>
            <div className="feedback-scale">
              {feedbackRatings.map((rating) => (
                <label key={rating}>
                  <input type="radio" name="rating" value={rating} checked={draft.rating === rating}
                    onChange={() => save({ ...draft, rating })} required />
                  <span lang={rating === 'NPC' ? 'en' : undefined}>{rating}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="feedback-message">
            <label htmlFor="feedback-message">你希望我们改进什么？<span>选填</span></label>
            <textarea id="feedback-message" name="message" rows={4} value={message} maxLength={feedbackMaxLength}
              onChange={(event) => save({ ...draft, message: event.target.value })} readOnly={status === 'sending'}
              placeholder="遇到的问题、想增加的功能，都可以写在这里。" />
          </div>
          {error && <p className="study-message error" role="alert">{error}</p>}
          <div className="feedback-actions">
            <span className="feedback-count">{message.length} / {feedbackMaxLength}</span>
            <button className="btn primary feedback-submit" type="submit" disabled={status === 'sending'}
              aria-busy={status === 'sending'}>
              {status === 'sending' ? '正在提交…' : '提交反馈'}
            </button>
          </div>
        </form>
      )}
      <div className={status === 'sent' ? 'feedback-success' : undefined} role="status">
        {status === 'sent' && <p>反馈已提交，感谢你的建议！</p>}
      </div>
    </div>
  </section>
}
