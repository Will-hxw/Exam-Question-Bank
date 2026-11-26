'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { requestJson } from '@/features/study/api'
import { authorChatPath } from './types'

export function useChatUnread(userId: string, inFeedback: boolean) {
  const [unread, setUnread] = useState(false)
  const [sharedUnread, setSharedUnread] = useState(false)
  const version = useRef(0)
  const sharedVersion = useRef(0)
  const updateUnread = useCallback((next: boolean) => {
    version.current += 1
    setUnread(next)
  }, [])
  const updateSharedUnread = useCallback((next: boolean) => {
    sharedVersion.current += 1
    setSharedUnread(next)
  }, [])

  useEffect(() => {
    const stop = new AbortController()
    let polling = false
    let timer: ReturnType<typeof setTimeout>
    async function refresh() {
      clearTimeout(timer)
      if (polling || stop.signal.aborted || document.hidden || !navigator.onLine) return
      polling = true
      const revision = version.current
      const sharedRevision = sharedVersion.current
      try {
        const result = await requestJson<{ unread: boolean; sharedUnread: boolean }>(`${authorChatPath}?withShared=1`, {
          headers: { 'X-Study-Account': userId },
          signal: AbortSignal.any([stop.signal, AbortSignal.timeout(9000)]),
        })
        if (stop.signal.aborted) return
        if (version.current === revision) setUnread(result.unread)
        if (sharedVersion.current === sharedRevision) setSharedUnread(result.sharedUnread)
      } catch { /* Keep the last confirmed indication until the next successful check. */ }
      finally {
        polling = false
        if (!stop.signal.aborted && !document.hidden && navigator.onLine) timer = setTimeout(refresh, 15_000)
      }
    }
    if (inFeedback) void refresh()
    else timer = setTimeout(refresh, 2800)
    document.addEventListener('visibilitychange', refresh)
    window.addEventListener('online', refresh)
    return () => {
      stop.abort()
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', refresh)
      window.removeEventListener('online', refresh)
    }
  }, [inFeedback, userId])

  return { unread, sharedUnread, updateUnread, updateSharedUnread }
}
