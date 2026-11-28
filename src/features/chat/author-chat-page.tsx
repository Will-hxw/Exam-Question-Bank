'use client'

import { type MouseEventHandler, useEffect, useRef, useState } from 'react'
import { Button, TextInput, UnreadDot } from '@/components/ui'
import { messages } from '@/config/messages'
import { siteConfig } from '@/config/site'
import { requestJson } from '@/features/study/api'
import ChatPage, { Avatar, ChatHeader, messageTime } from './chat-page'
import { authorChatHash, authorChatPath, unreadDescriptionId, type AuthorInbox } from './types'
import { chatError, useChatRoom } from './use-chat-room'

function InboxList({ userId, onlyUnread, search, onOpenThread }: {
  userId: string; onlyUnread: boolean; search: string; onOpenThread: MouseEventHandler<HTMLAnchorElement>
}) {
  const [inbox, setInbox] = useState<AuthorInbox>()
  const [depth, setDepth] = useState(1)
  const [error, setError] = useState('')
  const [loadingMore, setLoadingMore] = useState(false)
  const [retry, setRetry] = useState(0)
  const params = new URLSearchParams({ inbox: '1', directory: '1' })
  if (onlyUnread) params.set('unread', '1')
  if (search) params.set('q', search)
  const path = `${authorChatPath}?${params}`

  useEffect(() => {
    const stop = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    let loading = false
    const readPage = (cursor?: string) => requestJson<AuthorInbox>(
      cursor ? `${path}&before=${encodeURIComponent(cursor)}` : path, {
        headers: { [siteConfig.api.accountHeader]: userId },
        signal: AbortSignal.any([stop.signal, AbortSignal.timeout(siteConfig.timings.authorInboxTimeoutMs)]),
      },
    )
    async function refresh() {
      clearTimeout(timer)
      if (loading || stop.signal.aborted || document.hidden) return
      loading = true
      try {
        const first = await readPage()
        const rows = new Map(first.conversations.map((row) => [row.userId, row]))
        let nextCursor = first.nextCursor
        for (let index = 1; index < depth && nextCursor; index++) {
          const page = await readPage(nextCursor)
          for (const row of page.conversations) if (!rows.has(row.userId)) rows.set(row.userId, row)
          nextCursor = page.nextCursor
        }
        if (!stop.signal.aborted) {
          setInbox({ conversations: [...rows.values()], nextCursor })
          setError('')
        }
      } catch (failure) {
        if (!stop.signal.aborted) setError(chatError(failure, messages.authorChat.inboxLoadError))
      } finally {
        loading = false
        if (!stop.signal.aborted) {
          setLoadingMore(false)
          if (!document.hidden) timer = setTimeout(refresh, siteConfig.timings.authorInboxRefreshMs)
        }
      }
    }
    void refresh()
    document.addEventListener('visibilitychange', refresh)
    window.addEventListener('online', refresh)
    return () => {
      stop.abort()
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', refresh)
      window.removeEventListener('online', refresh)
    }
  }, [depth, path, retry, userId])

  function loadMore() {
    if (!inbox?.nextCursor || loadingMore) return
    setLoadingMore(true)
    setError('')
    setDepth((pages) => pages + 1)
  }

  const conversations = inbox?.conversations ?? []
  return (
    <div className="flex flex-1 min-h-0 flex-col gap-3 overflow-y-auto overscroll-contain">
      {error && (
        <p className="m-0 text-xs text-wrong-ink flex items-center gap-2" role="status">
          <span>{error}</span>
          <Button variant="surface" size="xs" onClick={() => setRetry((value) => value + 1)}>{messages.common.retry}</Button>
        </p>
      )}
      <div className="flex flex-col gap-2" role="region" aria-label={messages.authorChat.regionAria}>
        {conversations.length > 0 ? (
          <ul className="m-0 p-0 list-none flex flex-col gap-2">
            {conversations.map((row) => (
              <li key={row.userId}>
                <a
                  href={`${authorChatHash}/${row.id ?? `contact/${encodeURIComponent(row.userId)}`}`}
                  className="btn-surface p-3.5 rounded-option flex items-center gap-3 no-underline text-left"
                  onClick={onOpenThread}
                  aria-describedby={row.unread ? unreadDescriptionId : undefined}
                >
                  <div className="relative shrink-0">
                    <Avatar profile={row.peer} size={42} />
                    {row.unread && <UnreadDot className="absolute top-0 right-0 w-2.5 h-2.5" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between gap-2">
                      <strong className="text-sm font-semibold truncate text-ink-primary" title={row.peer.nickname}>{row.peer.nickname}</strong>
                      {row.sentAt && <time className="text-micro text-ink-muted shrink-0" dateTime={row.sentAt}>{messageTime(row.sentAt)}</time>}
                    </div>
                    {row.peer.email && <small className="block text-micro text-ink-muted truncate" title={row.peer.email}>{row.peer.email}</small>}
                    <p className="m-0 mt-0.5 text-xs text-ink-secondary truncate">
                      {row.mine && messages.authorChat.youPrefix}
                      {row.preview ?? messages.authorChat.noMessagesPreview}
                    </p>
                  </div>
                </a>
              </li>
            ))}
          </ul>
        ) : !error && (
          <p className="py-10 text-center text-sm text-ink-muted" role="status">
            {!inbox ? messages.authorChat.loadingInbox
              : search ? messages.authorChat.noMatchingContacts
              : onlyUnread ? messages.authorChat.noUnreadThreads
              : messages.authorChat.noRegisteredUsers}
          </p>
        )}
        {inbox?.nextCursor && (
          <div className="text-center pt-2">
            <Button variant="surface" size="sm" disabled={loadingMore} onClick={loadMore}>
              {loadingMore ? messages.common.loading : messages.authorChat.loadMoreThreads}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

function Inbox({ userId, onlyUnread, setOnlyUnread, search, setSearch, onBack, onOpenThread }: {
  userId: string
  onlyUnread: boolean
  setOnlyUnread: (value: boolean) => void
  search: string
  setSearch: (value: string) => void
  onBack: MouseEventHandler<HTMLAnchorElement>
  onOpenThread: MouseEventHandler<HTMLAnchorElement>
}) {
  const heading = useRef<HTMLHeadingElement>(null)
  const [query, setQuery] = useState(search.trim())
  useEffect(() => {
    heading.current?.focus({ preventScroll: true })
  }, [])
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), siteConfig.timings.searchDebounceMs)
    return () => clearTimeout(timer)
  }, [search])
  return (
    <section className="chat-shell" aria-labelledby="chat-title">
      <ChatHeader title={messages.chat.authorTitle} heading={heading} backHref={siteConfig.hashes.feedback} backLabel={messages.authorChat.backToFeedback} onBack={onBack} />
      <div className="flex items-center gap-2.5 flex-wrap">
        <div className="flex items-center gap-1.5" role="group" aria-label={messages.authorChat.filterThreadsAria}>
          <Button variant={!onlyUnread ? 'cta' : 'surface'} size="md" aria-pressed={!onlyUnread} onClick={() => setOnlyUnread(false)}>
            {messages.common.all}
          </Button>
          <Button variant={onlyUnread ? 'cta' : 'surface'} size="md" aria-pressed={onlyUnread} onClick={() => setOnlyUnread(true)}>
            {messages.authorChat.onlyUnread}
          </Button>
        </div>
        <TextInput
          type="search"
          className="h-9.5 flex-1 min-w-44"
          aria-label={messages.authorChat.searchThreadsAria}
          placeholder={messages.authorChat.searchThreadsPlaceholder}
          maxLength={siteConfig.limits.searchInputMax}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>
      <InboxList key={`${onlyUnread}:${query}`} userId={userId} onlyUnread={onlyUnread} search={query} onOpenThread={onOpenThread} />
    </section>
  )
}

function Thread({ userId, author, threadId, allowCreate, onRead, onBack }: {
  userId: string
  author: boolean
  threadId?: string
  allowCreate: boolean
  onRead: (unread: boolean) => void
  onBack: MouseEventHandler<HTMLAnchorElement>
}) {
  const contact = threadId?.startsWith('contact/') ? threadId.slice('contact/'.length) : undefined
  const room = useChatRoom(userId, { threadId: contact === undefined ? threadId : undefined, contact, allowCreate })
  const participant = author ? room.peer?.authorKey ?? threadId : 'own'
  const draftKey = siteConfig.storageKeys.chatDraft(userId, `author:${participant}`)
  return (
    <ChatPage
      room={room}
      draftKey={draftKey}
      direct
      backHref={author ? authorChatHash : siteConfig.hashes.feedback}
      backLabel={author ? messages.authorChat.backToThreadList : messages.authorChat.backToFeedback}
      onRead={onRead}
      onBack={onBack}
    />
  )
}

export default function AuthorChatPage({ userId, author, threadId, allowCreate, onRead, onBack, onOpenThread }: {
  userId: string
  author: boolean
  threadId?: string
  allowCreate: boolean
  onRead: (unread: boolean) => void
  onBack: MouseEventHandler<HTMLAnchorElement>
  onOpenThread: MouseEventHandler<HTMLAnchorElement>
}) {
  const [onlyUnread, setOnlyUnread] = useState(false)
  const [search, setSearch] = useState('')
  if (author && !threadId) return <Inbox userId={userId} onlyUnread={onlyUnread} setOnlyUnread={setOnlyUnread}
    search={search} setSearch={setSearch} onBack={onBack} onOpenThread={onOpenThread} />
  return <Thread key={author ? threadId : userId} userId={userId} author={author}
    threadId={author ? threadId : undefined} allowCreate={allowCreate} onRead={onRead} onBack={onBack} />
}
