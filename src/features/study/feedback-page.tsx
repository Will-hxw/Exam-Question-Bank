'use client'

import { type FormEvent, type MouseEventHandler, useEffect, useRef, useState } from 'react'
import { requestJson, StudyRequestError } from './api'
import { feedbackMaxLength, feedbackRatings } from './feedback'

export function MailboxIcon({ size = 20 }: { size?: number }) {
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 20v-7a6 6 0 0 1 6-6h6a6 6 0 0 1 6 6v7H3Z" />
    <path d="M9 7a6 6 0 0 1 6 6v7M6.5 14h5M17 7V3h4" />
  </svg>
}

export function FeedbackPage({ pathname, userId, onBack }: {
  pathname: string
  userId: string
  onBack: MouseEventHandler<HTMLAnchorElement>
}) {
  const page = useRef<HTMLElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const [message, setMessage] = useState('')
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent'>('idle')
  const [error, setError] = useState('')

  useEffect(() => {
    heading.current?.focus({ preventScroll: true })
    page.current?.scrollIntoView({ block: 'start' })
  }, [])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (status !== 'idle') return
    const rating = new FormData(event.currentTarget).get('rating')
    const content = message.trim()
    if (!rating || !content) {
      setError('请选择评价，并填写你的意见或建议。')
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
        <MailboxIcon size={24} />
        <h1 ref={heading} id="feedback-title" tabIndex={-1}>意见反馈</h1>
      </header>
      {status !== 'sent' && (
        <form className="feedback-form" onSubmit={submit}>
          <fieldset className="feedback-rating" disabled={status === 'sending'}>
            <legend>你觉得练习站怎么样？</legend>
            <div className="feedback-scale">
              {feedbackRatings.map((rating) => (
                <label key={rating}>
                  <input type="radio" name="rating" value={rating} required />
                  <span lang={rating === 'NPC' ? 'en' : undefined}>{rating}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="feedback-message">
            <label htmlFor="feedback-message">你希望我们改进什么？</label>
            <textarea id="feedback-message" name="message" rows={4} value={message} maxLength={feedbackMaxLength}
              onChange={(event) => setMessage(event.target.value)} required readOnly={status === 'sending'}
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
