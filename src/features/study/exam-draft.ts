'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { type Question, requestJson, StudyRequestError, writeJson } from './api'
import {
  decodeExamDraft, type ExamDraft, mergeExamDraft, sameExamAnswers, sameExamDraft, unsubmittedAnswerIds,
} from './exam-draft-merge'

export type Exam = ExamDraft & {
  id: string
  status: 'draft' | 'submitted'
  startedAt: string
  submittedAt: string | null
  items: Question[]
  score: number | null
  correctness?: Record<string, boolean>
}

type SyncStatus = 'synced' | 'local' | 'pending' | 'error' | 'conflict'
type PendingMerge = ReturnType<typeof mergeExamDraft> & { cloud: ExamDraft }
type FinishedExam = { exam: Exam; elsewhere: boolean }

function draftKey(userId: string, examId: string) {
  return `cqu-study-draft:${userId}:${examId}`
}

function answerData(draft: ExamDraft): ExamDraft {
  return { answers: draft.answers, marked: draft.marked, position: draft.position, revision: draft.revision }
}

function loadLocal(key: string) {
  try {
    const raw = localStorage.getItem(key)
    const stored = raw && decodeExamDraft(JSON.parse(raw))
    if (stored) return { raw, stored }
  } catch { /* The remote copy is still usable. */ }
  return null
}

export function readLocalExamDraft(userId: string, examId: string) {
  return loadLocal(draftKey(userId, examId))?.stored ?? null
}

export function useExamDraft(userId: string, exam: Exam) {
  const localKey = draftKey(userId, exam.id)
  const path = `/api/exams/${exam.id}`
  const [initial] = useState(() => {
    const saved = loadLocal(localKey)
    const cloud = answerData(exam)
    const stored = saved?.stored
    if (!stored || sameExamDraft(stored.draft, cloud)) {
      return { draft: cloud, base: cloud, dirty: false, refresh: false, raw: saved?.raw }
    }
    const refresh = stored.draft.revision !== cloud.revision
    return { draft: stored.draft, base: refresh ? stored.base : cloud, dirty: true, refresh, raw: saved?.raw }
  })
  const [draft, setDraft] = useState(initial.draft)
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(initial.dirty ? 'local' : 'synced')
  const [pendingMerge, setPendingMerge] = useState<PendingMerge | null>(null)
  const [finished, setFinished] = useState<FinishedExam | null>(null)
  const latest = useRef(draft)
  const base = useRef(initial.base)
  const dirty = useRef(initial.dirty)
  const refreshNeeded = useRef(initial.refresh)
  const merge = useRef<PendingMerge | null>(null)
  const closed = useRef(false)
  const inFlight = useRef<Promise<void> | null>(null)
  const storageTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const storedValue = useRef(initial.raw)

  const persist = useCallback(() => {
    try {
      const value = JSON.stringify({ draft: latest.current, base: base.current })
      localStorage.setItem(localKey, value)
      storedValue.current = value
      return true
    } catch { return false }
  }, [localKey])

  const clearStored = useCallback(() => {
    try {
      if (storedValue.current !== undefined && localStorage.getItem(localKey) === storedValue.current) {
        localStorage.removeItem(localKey)
      }
    } catch { /* The server already has the saved draft. */ }
  }, [localKey])

  const adopt = useCallback((next: ExamDraft, cloud: ExamDraft) => {
    base.current = cloud
    latest.current = next
    dirty.current = !sameExamDraft(next, cloud)
    setDraft(next)
    if (dirty.current) setSyncStatus(persist() ? 'local' : 'pending')
    else {
      clearStored()
      setSyncStatus('synced')
    }
  }, [clearStored, persist])

  const finish = useCallback((result: Exam, elsewhere: boolean) => {
    closed.current = true
    if (unsubmittedAnswerIds({ draft: latest.current, base: base.current }, result).length) persist()
    else clearStored()
    setFinished({ exam: result, elsewhere })
  }, [clearStored, persist])

  const refresh = useCallback(async () => {
    const { exam: remote } = await requestJson<{ exam: Exam }>(path, { headers: { 'X-Study-Account': userId } })
    refreshNeeded.current = false
    if (remote.status === 'submitted') {
      finish(remote, true)
      return
    }
    const cloud = answerData(remote)
    const proposed = mergeExamDraft(latest.current, cloud, base.current)
    if (proposed.conflicts.length) {
      merge.current = { ...proposed, cloud }
      setPendingMerge(merge.current)
      setSyncStatus('conflict')
    } else {
      adopt(proposed.draft, cloud)
    }
  }, [adopt, finish, path, userId])

  const flush = useCallback(async (keepalive = false) => {
    if (inFlight.current) return inFlight.current
    if (closed.current || merge.current || (!dirty.current && !refreshNeeded.current)) return
    const operation = (async () => {
      try {
        let conflicts = 0
        while (!closed.current && !merge.current && (dirty.current || refreshNeeded.current)) {
          if (refreshNeeded.current) {
            if (keepalive) return
            await refresh()
            continue
          }
          const snapshot = latest.current
          try {
            const { revision } = await writeJson<{ revision: number }>(path + '?ack=1', userId, 'PUT', snapshot, keepalive)
            adopt({ ...latest.current, revision }, { ...snapshot, revision })
          } catch (error) {
            if (!(error instanceof StudyRequestError) || error.status !== 409) throw error
            refreshNeeded.current = true
            if (keepalive || ++conflicts >= 3) throw error
          }
        }
      } catch (error) {
        setSyncStatus('error')
        throw error
      }
    })()
    inFlight.current = operation
    try { await operation } finally { inFlight.current = null }
  }, [adopt, path, refresh, userId])

  useEffect(() => {
    if (!dirty.current && !closed.current) clearStored()
    const restore = () => { void flush().catch(() => {}) }
    const leaving = () => { void flush(true).catch(() => {}) }
    const timer = setTimeout(restore, 800)
    window.addEventListener('online', restore)
    window.addEventListener('pagehide', leaving)
    return () => {
      clearTimeout(timer)
      if (storageTimer.current) {
        clearTimeout(storageTimer.current)
        void flush().catch(() => {})
      }
      window.removeEventListener('online', restore)
      window.removeEventListener('pagehide', leaving)
    }
  }, [clearStored, flush])

  function update(change: (current: ExamDraft) => Partial<Omit<ExamDraft, 'revision'>>) {
    if (merge.current || closed.current) return
    const next = { ...latest.current, ...change(latest.current) }
    if (sameExamDraft(latest.current, next)) return
    latest.current = next
    dirty.current = true
    setDraft(next)
    setSyncStatus(persist() ? 'local' : 'pending')
    if (storageTimer.current) clearTimeout(storageTimer.current)
    storageTimer.current = setTimeout(() => { void flush().catch(() => {}) }, 750)
  }

  function resolve(choices: Record<string, 'local' | 'cloud'>) {
    const review = merge.current
    if (!review || !review.conflicts.every(({ id }) => choices[id])) return
    const answers = { ...review.draft.answers }
    for (const conflict of review.conflicts) answers[conflict.id] = conflict[choices[conflict.id]]
    merge.current = null
    setPendingMerge(null)
    adopt({ ...review.draft, answers }, review.cloud)
    void flush().catch(() => {})
  }

  // If a rebase changes the answers after the user clicks confirm, require confirmation again.
  async function submit() {
    if (storageTimer.current) clearTimeout(storageTimer.current)
    const confirmed = latest.current
    await flush()
    if (closed.current || merge.current) return false
    const snapshot = latest.current
    if (!sameExamAnswers(confirmed, snapshot)) return true
    try {
      const { exam: result } = await writeJson<{ exam: Exam }>(path + '/submit', userId, 'POST', snapshot)
      finish(result, result.revision !== snapshot.revision + 1 || !sameExamAnswers(snapshot, result))
      return false
    } catch (error) {
      if (!(error instanceof StudyRequestError) || error.status !== 409) throw error
      refreshNeeded.current = true
      await flush()
      return !closed.current && !merge.current
    }
  }

  return { draft, update, flush, submit, syncStatus, pendingMerge, resolve, finished }
}
