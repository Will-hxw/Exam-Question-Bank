'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { type Question, StudyRequestError, writeJson } from './api'

export type ExamDraft = { answers: Record<string, string[]>; marked: string[]; position: number; revision: number }
export type Exam = ExamDraft & {
  id: string
  status: 'draft' | 'submitted'
  startedAt: string
  submittedAt: string | null
  items: Question[]
  score: number | null
  correctness?: Record<string, boolean>
}

function answerData(draft: ExamDraft): ExamDraft {
  return { answers: draft.answers, marked: draft.marked, position: draft.position, revision: draft.revision }
}

function loadLocal(key: string) {
  try {
    const serialized = localStorage.getItem(key)
    if (serialized) {
      return JSON.parse(serialized) as ExamDraft
    }
  } catch { /* The remote copy is still usable. */ }
  return null
}

function sameIds(left: string[], right: string[]) {
  return left.length === right.length && left.every((id) => right.includes(id))
}

function sameDraft(left: ExamDraft, right: ExamDraft) {
  const ids = new Set([...Object.keys(left.answers), ...Object.keys(right.answers)])
  return left.position === right.position && sameIds(left.marked, right.marked)
    && [...ids].every((id) => sameIds(left.answers[id] ?? [], right.answers[id] ?? []))
}

export function useExamDraft(userId: string, exam: Exam) {
  const localKey = `cqu-study-draft:${userId}:${exam.id}`
  const [recovered] = useState(() => loadLocal(localKey))
  const pending = recovered?.revision === exam.revision
  const unresolved = Boolean(recovered && !pending && !sameDraft(recovered, exam))
  const [draft, setDraft] = useState<ExamDraft>(() => pending && recovered ? recovered : answerData(exam))
  const [syncStatus, setSyncStatus] = useState<'synced' | 'local' | 'pending' | 'error' | 'conflict'>(unresolved ? 'conflict' : pending ? 'local' : 'synced')
  const latest = useRef(draft)
  const dirty = useRef(pending)
  const conflict = useRef(unresolved)
  const inFlight = useRef<Promise<ExamDraft> | null>(null)
  const storageTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const persist = useCallback((snapshot: ExamDraft) => {
    try {
      localStorage.setItem(localKey, JSON.stringify(snapshot))
      return true
    } catch {
      return false
    }
  }, [localKey])

  const clearStored = useCallback(() => {
    try { localStorage.removeItem(localKey) } catch { /* The server already has the saved draft. */ }
  }, [localKey])

  const flush = useCallback(async (): Promise<ExamDraft> => {
    if (inFlight.current) return inFlight.current
    if (conflict.current) throw new StudyRequestError(409)
    if (!dirty.current) return latest.current
    const operation = (async () => {
      try {
        while (dirty.current) {
          const snapshot = latest.current
          const { exam: saved } = await writeJson<{ exam: Exam }>(`/api/exams/${exam.id}`, userId, 'PUT', snapshot)
          dirty.current = latest.current !== snapshot
          latest.current = { ...latest.current, revision: saved.revision }
          setDraft(latest.current)
          if (dirty.current) persist(latest.current)
          else clearStored()
        }
        setSyncStatus('synced')
        return latest.current
      } catch (error) {
        conflict.current = error instanceof StudyRequestError && error.status === 409
        setSyncStatus(conflict.current ? 'conflict' : 'error')
        throw error
      } finally {
        inFlight.current = null
      }
    })()
    inFlight.current = operation
    return operation
  }, [clearStored, exam.id, persist, userId])

  useEffect(() => {
    const restore = () => { void flush().catch(() => {}) }
    const timer = setTimeout(restore, 800)
    window.addEventListener('online', restore)
    return () => {
      clearTimeout(timer)
      if (storageTimer.current) {
        clearTimeout(storageTimer.current)
        void flush().catch(() => {})
      }
      window.removeEventListener('online', restore)
    }
  }, [flush])

  function update(change: Partial<Omit<ExamDraft, 'revision'>>) {
    if (conflict.current) return
    const next = { ...latest.current, ...change }
    latest.current = next
    dirty.current = true
    setDraft(next)
    setSyncStatus(persist(next) ? 'local' : 'pending')
    if (storageTimer.current) clearTimeout(storageTimer.current)
    storageTimer.current = setTimeout(() => { void flush().catch(() => {}) }, 750)
  }

  async function submit() {
    if (storageTimer.current) clearTimeout(storageTimer.current)
    const snapshot = await flush()
    const { exam: result } = await writeJson<{ exam: Exam }>(`/api/exams/${exam.id}/submit`, userId, 'POST', snapshot)
    clearStored()
    return result
  }

  function abandonLocalDraft() {
    latest.current = answerData(exam)
    dirty.current = false
    clearStored()
  }

  return { draft, update, flush, submit, syncStatus, abandonLocalDraft }
}
