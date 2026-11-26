'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { requestJson, StudyRequestError, writeJson } from '@/features/study/api'
import { currentSharedRoom, refreshSharedChatSnapshot, sharedChatPath as chatPath, warmSharedChat } from './shared-chat-cache'
import { authorChatPath, type AuthorChatRoom, type AuthorChatPeer, type ChatAuthor, type ChatMessage, type ChatPage, type ChatProfile, type ChatUpdates } from './types'

export function chatError(error: unknown, fallback: string) {
  return error instanceof StudyRequestError ? error.message : fallback
}

export function useChatRoom(userId: string, direct?: { threadId?: string; allowCreate?: boolean }) {
  const privateRoom = direct !== undefined
  const requestedThread = direct?.threadId
  const allowCreate = direct?.allowCreate ?? false
  const [cached] = useState(() => privateRoom ? undefined : currentSharedRoom(userId)?.data)
  const [profile, setProfile] = useState<ChatProfile | undefined>(cached?.profile)
  const [peer, setPeer] = useState<AuthorChatPeer>()
  const [authorAvatar, setAuthorAvatar] = useState(cached?.authorAvatar)
  const [authors, setAuthors] = useState(() => new Map<string, ChatAuthor>())
  const [messages, setMessages] = useState<ChatMessage[]>(cached?.messages ?? [])
  const [hasOlder, setHasOlder] = useState(cached?.hasMore ?? false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [readError, setReadError] = useState('')
  const [historyError, setHistoryError] = useState('')
  const [revision, setRevision] = useState(0)
  const cursor = useRef<string | null>(cached ? cached.messages.at(-1)?.id ?? '0' : null)
  const nicknameCursor = useRef(cached?.nicknameCursor ?? '0')
  const [thread, setThread] = useState(requestedThread)
  const threadRef = useRef(requestedThread)
  const historyPending = useRef(false)
  const headers = { 'X-Study-Account': userId }

  const mergeAuthors = useCallback((incoming: ChatAuthor[]) => {
    if (!incoming.length) return
    setAuthors((previous) => {
      let next = previous
      for (const author of incoming) {
        if (!author.authorKey) continue
        const current = next.get(author.authorKey)
        if (!current || BigInt(author.nicknameRevision) > BigInt(current.nicknameRevision)) {
          if (next === previous) next = new Map(previous)
          next.set(author.authorKey, author)
        }
      }
      return next
    })
  }, [])

  function displayNickname(author: ChatAuthor) {
    return authors.get(author.authorKey)?.nickname ?? author.nickname
  }

  const merge = useCallback((incoming: ChatMessage[]) => {
    if (!incoming.length) return
    mergeAuthors(incoming)
    setMessages((previous) => {
      const combined = new Map(previous.map((message) => [message.id, message]))
      for (const item of incoming) combined.set(item.id, item)
      return [...combined.values()].sort((a, b) => BigInt(a.id) < BigInt(b.id) ? -1 : 1)
    })
  }, [mergeAuthors])

  useEffect(() => {
    const stop = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    let fetching = false
    let halted = false

    async function refresh() {
      clearTimeout(timer)
      if (fetching || halted || stop.signal.aborted || document.hidden || !navigator.onLine) return
      fetching = true
      let delay = 5000
      try {
        const after = cursor.current
        const options = {
          headers: { 'X-Study-Account': userId },
          signal: AbortSignal.any([stop.signal, AbortSignal.timeout(9000)]),
        }
        if (after === null) {
          const initial = privateRoom
            ? await (threadRef.current
              ? requestJson<AuthorChatRoom>(`${authorChatPath}?thread=${threadRef.current}`, options)
              : allowCreate
                ? requestJson<AuthorChatRoom>(authorChatPath, { ...options, method: 'POST' })
                : requestJson<AuthorChatRoom>(`${authorChatPath}?mine=1`, options))
            : await warmSharedChat(userId)
          if (stop.signal.aborted) return
          setProfile(initial.profile)
          if ('conversationId' in initial) {
            const room = initial as AuthorChatRoom
            threadRef.current = room.conversationId
            setThread(room.conversationId)
            setPeer(room.peer)
          }
          setAuthorAvatar(initial.authorAvatar)
          mergeAuthors([initial.profile])
          setHasOlder(initial.hasMore)
          merge(initial.messages)
          cursor.current = initial.messages.at(-1)?.id ?? '0'
          nicknameCursor.current = initial.nicknameCursor ?? '0'
        } else {
          const page = privateRoom
            ? await requestJson<AuthorChatRoom>(`${authorChatPath}?thread=${threadRef.current}&after=${after}`, options)
            : await requestJson<ChatUpdates>(`${chatPath}?after=${after}&nicknamesAfter=${nicknameCursor.current}`, options)
          if (stop.signal.aborted) return
          const nicknames = 'nicknames' in page ? page.nicknames : [page.profile, page.peer]
          merge(page.messages)
          mergeAuthors(nicknames)
          cursor.current = page.messages.at(-1)?.id ?? after
          if ('nicknames' in page) {
            nicknameCursor.current = nicknames.at(-1)?.nicknameRevision ?? nicknameCursor.current
            refreshSharedChatSnapshot(userId, page)
          }
          if (page.hasMore || ('hasMoreNicknames' in page && page.hasMoreNicknames)) delay = 0
        }
        setReadError('')
      } catch (error) {
        if (stop.signal.aborted) return
        halted = error instanceof StudyRequestError && [401, 403, 404, 409].includes(error.status)
        setReadError(chatError(error, '消息暂未同步，请检查网络。'))
        delay = 10000
      } finally {
        fetching = false
        if (!stop.signal.aborted && !halted && !document.hidden && navigator.onLine) {
          timer = setTimeout(refresh, delay)
        }
      }
    }

    function offline() {
      clearTimeout(timer)
      setReadError('网络已断开，联网后会自动同步。')
    }

    if (navigator.onLine) void refresh()
    else offline()
    document.addEventListener('visibilitychange', refresh)
    window.addEventListener('online', refresh)
    window.addEventListener('offline', offline)
    return () => {
      stop.abort()
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', refresh)
      window.removeEventListener('online', refresh)
      window.removeEventListener('offline', offline)
    }
  }, [userId, revision, merge, mergeAuthors, privateRoom, allowCreate])

  const path = thread ? `${authorChatPath}?thread=${thread}` : chatPath

  async function loadOlder(beforePrepend: () => void) {
    const before = messages[0]?.id
    if (!before || !hasOlder || historyPending.current) return
    historyPending.current = true
    setLoadingOlder(true)
    setHistoryError('')
    try {
      const page = await requestJson<ChatPage>(`${path}${thread ? '&' : '?'}before=${before}`, { headers })
      if (page.messages.length) beforePrepend()
      merge(page.messages)
      setHasOlder(page.hasMore)
    } catch (error) {
      setHistoryError(chatError(error, '聊天记录暂未加载，请重试。'))
    } finally {
      setLoadingOlder(false)
      historyPending.current = false
    }
  }

  async function send(message: string, clientId: string) {
    const sent = await writeJson<{ message: ChatMessage }>(path, userId, 'POST', { message, clientId }, true)
    merge([sent.message])
  }

  async function rename(nickname: string) {
    const updated = await writeJson<{ profile: ChatProfile }>(chatPath, userId, 'PUT', { nickname })
    mergeAuthors([updated.profile])
  }

  const readPath = privateRoom ? path : `${chatPath}/read`
  const markRead = useCallback((through: string) => writeJson<{ unread: boolean }>(
    readPath, userId, 'PUT', { through }, true,
  ), [readPath, userId])

  return { profile: profile && { ...profile, nickname: displayNickname(profile) },
    peer: peer && { ...peer, nickname: displayNickname(peer) }, authorAvatar, messages, displayNickname,
    markRead: !privateRoom || thread ? markRead : undefined,
    hasOlder, loadingOlder, readError, historyError, loadOlder, send, rename,
    retry: () => setRevision((key) => key + 1) }
}
