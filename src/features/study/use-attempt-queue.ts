'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { type Attempt, StudyRequestError, writeJson } from './api'

type PendingAttempt = Attempt & { createdAt: number }
type AttemptResult = { eventId: string; status: 'saved' | 'unavailable' | 'invalid_options' | 'conflict'; correct?: boolean }

function queuePrefix(userId: string) {
  return `cqu-study-attempt:${userId}:`
}

function readQueue(prefix: string) {
  const items: PendingAttempt[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (!key?.startsWith(prefix)) continue
    const text = localStorage.getItem(key)
    if (text) items.push(JSON.parse(text) as PendingAttempt)
  }
  return items.sort((a, b) => a.createdAt - b.createdAt || a.eventId.localeCompare(b.eventId))
}

export function useAttemptQueue(userId: string, onSynced: () => void) {
  const prefix = queuePrefix(userId)
  const busy = useRef(false)
  const [status, setStatus] = useState<'idle' | 'pending' | 'synced' | 'error' | 'rejected'>('idle')

  const flush = useCallback(async () => {
    if (busy.current) return
    busy.current = true
    try {
      let queue = readQueue(prefix)
      if (!queue.length) return
      setStatus('pending')
      if (!navigator.onLine) return
      let rejected = false
      while (queue.length) {
        const batch = queue.slice(0, 20)
        const events = batch.map(({ eventId, questionId, optionIds, mode, contentRevision }) => ({ eventId, questionId, optionIds, mode, contentRevision }))
        const { results } = await writeJson<{ results: AttemptResult[] }>('/api/attempts/batch', userId, 'POST', { ownerId: userId, events })
        const byId = new Map(results.map((result) => [result.eventId, result]))
        for (const item of batch) {
          const outcome = byId.get(item.eventId)
          if (!outcome) throw new Error('Attempt response incomplete')
          if (outcome.status !== 'saved') rejected = true
          localStorage.removeItem(`${prefix}${item.eventId}`)
        }
        queue = readQueue(prefix)
      }
      setStatus(rejected ? 'rejected' : 'synced')
      onSynced()
    } catch (error) {
      if (error instanceof StudyRequestError) setStatus('error')
      else setStatus(navigator.onLine ? 'error' : 'pending')
    } finally {
      busy.current = false
    }
  }, [onSynced, prefix, userId])

  useEffect(() => {
    const sync = () => { void flush() }
    const initialSync = setTimeout(sync, 0)
    window.addEventListener('online', sync)
    window.addEventListener('focus', sync)
    return () => {
      clearTimeout(initialSync)
      window.removeEventListener('online', sync)
      window.removeEventListener('focus', sync)
    }
  }, [flush])

  function enqueue(questionId: string, optionIds: string[], contentRevision?: string) {
    const item: PendingAttempt = { eventId: crypto.randomUUID(), mode: 'practice', questionId, optionIds, contentRevision, createdAt: Date.now() }
    try {
      localStorage.setItem(`${prefix}${item.eventId}`, JSON.stringify(item))
    } catch {
      setStatus('error')
      return false
    }
    setStatus('pending')
    void flush()
    return true
  }

  return { enqueue, flush, status }
}
