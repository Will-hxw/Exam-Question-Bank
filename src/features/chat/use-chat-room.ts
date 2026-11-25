'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { requestJson, StudyRequestError, writeJson } from '@/features/study/api'
import type { ChatAuthor, ChatMessage, ChatPage, ChatProfile, ChatRoom, ChatUpdates } from './types'

const chatPath = '/api/chat'

export function chatError(error: unknown, fallback: string) {
  return error instanceof StudyRequestError ? error.message : fallback
}

export function useChatRoom(userId: string) {
  const [profile, setProfile] = useState<ChatProfile>()
  const [authors, setAuthors] = useState(() => new Map<string, ChatAuthor>())
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [hasOlder, setHasOlder] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [readError, setReadError] = useState('')
  const [historyError, setHistoryError] = useState('')
  const [revision, setRevision] = useState(0)
  const cursor = useRef<string | null>(null)
  const nicknameCursor = useRef('0')
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
          const initial = await requestJson<ChatRoom>(chatPath, options)
          if (stop.signal.aborted) return
          setProfile(initial.profile)
          mergeAuthors([initial.profile])
          setHasOlder(initial.hasMore)
          merge(initial.messages)
          cursor.current = initial.messages.at(-1)?.id ?? '0'
          nicknameCursor.current = initial.nicknameCursor ?? '0'
        } else {
          const page = await requestJson<ChatUpdates>(`${chatPath}?after=${after}&nicknamesAfter=${nicknameCursor.current}`, options)
          if (stop.signal.aborted) return
          const nicknames = page.nicknames ?? []
          merge(page.messages)
          mergeAuthors(nicknames)
          cursor.current = page.messages.at(-1)?.id ?? after
          nicknameCursor.current = nicknames.at(-1)?.nicknameRevision ?? nicknameCursor.current
          if (page.hasMore || page.hasMoreNicknames) delay = 0
        }
        setReadError('')
      } catch (error) {
        if (stop.signal.aborted) return
        halted = error instanceof StudyRequestError && [401, 403, 409].includes(error.status)
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
  }, [userId, revision, merge, mergeAuthors])

  async function loadOlder(beforePrepend: () => void) {
    const before = messages[0]?.id
    if (!before || !hasOlder || historyPending.current) return
    historyPending.current = true
    setLoadingOlder(true)
    setHistoryError('')
    try {
      const page = await requestJson<ChatPage>(`${chatPath}?before=${before}`, { headers })
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
    const sent = await writeJson<{ message: ChatMessage }>(chatPath, userId, 'POST', { message, clientId })
    merge([sent.message])
  }

  async function rename(nickname: string) {
    const updated = await writeJson<{ profile: ChatProfile }>(chatPath, userId, 'PUT', { nickname })
    mergeAuthors([updated.profile])
  }

  return { profile: profile && { ...profile, nickname: displayNickname(profile) }, messages, displayNickname,
    hasOlder, loadingOlder, readError, historyError, loadOlder, send, rename,
    retry: () => setRevision((key) => key + 1) }
}
