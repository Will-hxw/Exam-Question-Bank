'use client'

import { useEffect, useRef, useState } from 'react'
import { requestJson } from '@/features/study/api'
import ChatPage, { Avatar, ChatHeader, messageTime } from './chat-page'
import { authorChatHash, authorChatPath, unreadDescriptionId, type AuthorInbox } from './types'
import { chatError, useChatRoom } from './use-chat-room'

function InboxList({ userId, onlyUnread, search }: { userId: string; onlyUnread: boolean; search: string }) {
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
    async function refresh() {
      clearTimeout(timer)
      if (loading || stop.signal.aborted || document.hidden) return
      loading = true
      try {
        const options = {
          headers: { 'X-Study-Account': userId },
          signal: AbortSignal.any([stop.signal, AbortSignal.timeout(9000)]),
        }
        const first = await requestJson<AuthorInbox>(path, options)
        const rows = new Map(first.conversations.map((row) => [row.userId, row]))
        let nextCursor = first.nextCursor
        for (let index = 1; index < depth && nextCursor; index++) {
          const page = await requestJson<AuthorInbox>(`${path}&before=${encodeURIComponent(nextCursor)}`, options)
          for (const row of page.conversations) if (!rows.has(row.userId)) rows.set(row.userId, row)
          nextCursor = page.nextCursor
        }
        if (!stop.signal.aborted) {
          setInbox({ conversations: [...rows.values()], nextCursor })
          setError('')
        }
      } catch (failure) {
        if (!stop.signal.aborted) setError(chatError(failure, '暂时无法读取会话。'))
      } finally {
        loading = false
        if (!stop.signal.aborted) {
          setLoadingMore(false)
          if (!document.hidden) timer = setTimeout(refresh, 12_000)
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
  return <>
    {error && <p className="chat-sync" role="status">{error}{' '}
      <button className="chat-text-button" type="button" onClick={() => setRetry((value) => value + 1)}>重试</button>
    </p>}
    <div className="author-inbox-log" role="region" aria-label="作者会话列表">
      {conversations.length > 0 ? <ul className="author-inbox-list">
        {conversations.map((row) => <li key={row.userId}>
          <a href={`${authorChatHash}/${row.id ?? `contact/${encodeURIComponent(row.userId)}`}`} className="author-inbox-row"
            aria-describedby={row.unread ? unreadDescriptionId : undefined}>
            <div className="author-inbox-avatar">
              <Avatar profile={row.peer} size={44} />
              {row.unread && <span className="message-unread-dot" aria-hidden="true" />}
            </div>
            <div className="author-inbox-details">
              <strong title={row.peer.nickname}>{row.peer.nickname}</strong>
              <small title={row.peer.email}>{row.peer.email}</small>
              <p>{row.mine && '你：'}{row.preview ?? '暂无消息'}</p>
            </div>
            {row.sentAt && <time dateTime={row.sentAt}>{messageTime(row.sentAt)}</time>}
          </a>
        </li>)}
      </ul> : !error && <p className="chat-loading" role="status">
        {!inbox ? '正在加载会话…' : search ? '没有匹配的联系人' : onlyUnread ? '没有未读会话' : '暂无注册用户'}
      </p>}
      {inbox?.nextCursor && <div className="chat-history">
        <button className="chat-text-button" type="button" disabled={loadingMore} onClick={loadMore}>
          {loadingMore ? '正在加载…' : '更多会话'}
        </button>
      </div>}
    </div>
  </>
}

function Inbox({ userId, onlyUnread, setOnlyUnread, search, setSearch }: {
  userId: string
  onlyUnread: boolean
  setOnlyUnread: (value: boolean) => void
  search: string
  setSearch: (value: string) => void
}) {
  const section = useRef<HTMLElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const [query, setQuery] = useState(search.trim())
  useEffect(() => {
    heading.current?.focus({ preventScroll: true })
    section.current?.scrollIntoView({ block: 'start' })
  }, [])
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 250)
    return () => clearTimeout(timer)
  }, [search])
  return <section ref={section} className="chat-room" aria-labelledby="chat-title">
    <ChatHeader title="作者对话" heading={heading} backHref="#feedback" backLabel="返回意见反馈" />
    <div className="author-inbox-controls">
      <div className="author-inbox-filter" role="group" aria-label="筛选会话">
        <button type="button" aria-pressed={!onlyUnread} onClick={() => setOnlyUnread(false)}>全部</button>
        <button type="button" aria-pressed={onlyUnread} onClick={() => setOnlyUnread(true)}>仅看未读</button>
      </div>
      <label className="author-inbox-search">
        <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
          strokeLinecap="round"><circle cx="10.5" cy="10.5" r="5.5" /><path d="m15 15 4.5 4.5" /></svg>
        <input type="search" aria-label="搜索会话" placeholder="昵称或邮箱" maxLength={100}
          value={search} onChange={(event) => setSearch(event.target.value)} />
      </label>
    </div>
    <InboxList key={`${onlyUnread}:${query}`} userId={userId} onlyUnread={onlyUnread} search={query} />
  </section>
}

function Thread({ userId, author, threadId, allowCreate, onRead }: {
  userId: string
  author: boolean
  threadId?: string
  allowCreate: boolean
  onRead: (unread: boolean) => void
}) {
  const contact = threadId?.startsWith('contact/') ? threadId.slice('contact/'.length) : undefined
  const room = useChatRoom(userId, { threadId: contact === undefined ? threadId : undefined, contact, allowCreate })
  const participant = author ? room.peer?.authorKey ?? threadId : 'own'
  const draftKey = `cqu-chat-draft:${userId}:author:${participant}`
  return <ChatPage room={room} draftKey={draftKey} direct backHref={author ? authorChatHash : '#feedback'}
    backLabel={author ? '返回会话列表' : '返回意见反馈'} onRead={onRead} />
}

export default function AuthorChatPage({ userId, author, threadId, allowCreate, onRead }: {
  userId: string
  author: boolean
  threadId?: string
  allowCreate: boolean
  onRead: (unread: boolean) => void
}) {
  const [onlyUnread, setOnlyUnread] = useState(false)
  const [search, setSearch] = useState('')
  if (author && !threadId) return <Inbox userId={userId} onlyUnread={onlyUnread} setOnlyUnread={setOnlyUnread}
    search={search} setSearch={setSearch} />
  return <Thread key={author ? threadId : userId} userId={userId} author={author}
    threadId={author ? threadId : undefined} allowCreate={allowCreate} onRead={onRead} />
}
