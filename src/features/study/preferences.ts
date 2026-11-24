'use client'

import { useCallback, useEffect, useEffectEvent, useRef, useState, useSyncExternalStore } from 'react'
import { libraryPageSize, questionUrl, requestJson, type QuestionType, type Status } from './api'

export type StudyPreferences = Record<string, unknown>
export type LibraryList = 'all' | 'wrong' | 'favorite'
export type LibraryView = { search: string; type: QuestionType | ''; topic: string; status: Status | ''; limit: number; page: number }
export const libraryPageSizes = [10, libraryPageSize, 30, 50]

export function readLibraryView(value: unknown): LibraryView {
  const saved = value as Partial<LibraryView> | undefined
  return {
    search: typeof saved?.search === 'string' ? saved.search.slice(0, 100) : '',
    type: saved?.type === 'single' || saved?.type === 'multiple' ? saved.type : '',
    topic: typeof saved?.topic === 'string' && /^[a-z0-9-]{1,50}$/i.test(saved.topic) ? saved.topic : '',
    status: saved?.status && ['done', 'undone', 'wrong', 'favorite'].includes(saved.status) ? saved.status : '',
    limit: typeof saved?.limit === 'number' && libraryPageSizes.includes(saved.limit) ? saved.limit : libraryPageSize,
    page: typeof saved?.page === 'number' && Number.isSafeInteger(saved.page) && saved.page >= 0 && saved.page <= 2000 ? saved.page : 0,
  }
}

export function libraryPath(list: LibraryList, view: LibraryView, q = view.search.trim()) {
  return questionUrl({
    topic: view.topic, type: view.type, q: list === 'all' ? q : '',
    status: list === 'all' ? view.status : list, offset: view.page ? view.page * view.limit : undefined, limit: view.limit,
  })
}

const subscribe = () => () => {}
const client = () => true
const server = () => false

export function useStudyPreferencesReady() {
  return useSyncExternalStore(subscribe, client, server)
}

function readStudyPreference(key: string): unknown {
  try {
    const text = localStorage.getItem(key)
    return text === null ? undefined : JSON.parse(text)
  } catch { return undefined }
}

export function writeStudyPreference(key: string, value: unknown) {
  try {
    if (value === undefined) localStorage.removeItem(key)
    else localStorage.setItem(key, JSON.stringify(value))
  } catch { /* The current view keeps its in-memory settings. */ }
}

export function useAccountStudyPreferences(userId: string, remote: StudyPreferences | undefined, loading: boolean) {
  const key = `cqu-account-preferences:${userId}`
  const [stored] = useState(() => readStudyPreference(key) as { values?: StudyPreferences; pending?: StudyPreferences } | undefined)
  const hydrated = useStudyPreferencesReady()
  const [confirmed, setConfirmed] = useState<StudyPreferences>({})
  const [pending, setPending] = useState<StudyPreferences>(stored?.pending ?? {})
  const [syncFailed, setSyncFailed] = useState(false)
  const queue = useRef<StudyPreferences>(stored?.pending ?? {})
  const cache = useRef<StudyPreferences>(stored?.values ?? {})
  const active = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const persist = useCallback(() => writeStudyPreference(key, { values: cache.current, pending: queue.current }), [key])
  const flush = useCallback(async (keepalive = false) => {
    if (active.current || !navigator.onLine || !Object.keys(queue.current).length) return
    active.current = true
    try {
      while (Object.keys(queue.current).length) {
        const batch = Object.fromEntries(Object.entries(queue.current).slice(0, 32))
        await requestJson('/api/me/preferences', {
          method: 'PUT', keepalive, headers: { 'Content-Type': 'application/json', 'X-Study-Account': userId },
          body: JSON.stringify(batch),
        })
        for (const [name, value] of Object.entries(batch)) {
          if (queue.current[name] === value) delete queue.current[name]
        }
        setConfirmed((previous) => ({ ...previous, ...batch }))
        setPending({ ...queue.current })
        persist()
      }
      setSyncFailed(false)
    } catch {
      setSyncFailed(true)
    } finally {
      active.current = false
    }
  }, [persist, userId])

  useEffect(() => {
    if (!remote) return
    cache.current = { ...remote, ...confirmed, ...queue.current }
    persist()
  }, [confirmed, persist, remote])

  useEffect(() => {
    const retry = () => { void flush() }
    const leave = () => { void flush(true) }
    const initial = setTimeout(retry, 0)
    window.addEventListener('online', retry)
    window.addEventListener('focus', retry)
    window.addEventListener('pagehide', leave)
    return () => {
      clearTimeout(initial)
      if (timer.current) clearTimeout(timer.current)
      window.removeEventListener('online', retry)
      window.removeEventListener('focus', retry)
      window.removeEventListener('pagehide', leave)
    }
  }, [flush])

  const save = useCallback((edits: StudyPreferences) => {
    Object.assign(queue.current, edits)
    Object.assign(cache.current, edits)
    setPending({ ...queue.current })
    persist()
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => { void flush() }, 400)
  }, [flush, persist])

  return {
    values: { ...(remote ?? stored?.values), ...confirmed, ...pending },
    ready: hydrated && (stored?.values !== undefined || remote !== undefined || !loading),
    save, syncFailed, retry: flush,
  }
}

const scrollViews: Record<string, string> = { '/': 'practice', '/questions': 'questions', '/wrong': 'wrong', '/favorites': 'favorites', '/exam': 'exam' }

export function useAccountStudyScroll(pathname: string, preferences: ReturnType<typeof useAccountStudyPreferences>) {
  const read = useEffectEvent((name: string) => preferences.values[name])
  const { ready, save } = preferences
  useEffect(() => {
    if (!ready || !scrollViews[pathname]) return
    const name = `scroll:${scrollViews[pathname]}`
    const saved = read(name)
    const target = typeof saved === 'number' ? saved : 0
    let restoring = true
    let debounce: ReturnType<typeof setTimeout> | undefined
    let last = target
    const observer = new ResizeObserver(() => restore())
    const finish = () => {
      restoring = false
      observer.disconnect()
    }
    function restore() {
      if (!restoring || document.documentElement.scrollHeight - innerHeight < target) return
      window.scrollTo(0, target)
      finish()
    }
    function persistPosition() {
      if (restoring) return
      const position = Math.min(1000000, Math.max(0, Math.round(scrollY)))
      if (position === last) return
      last = position
      clearTimeout(debounce)
      debounce = setTimeout(() => {
        debounce = undefined
        save({ [name]: last })
      }, 180)
    }
    const timeout = setTimeout(finish, 2000)
    observer.observe(document.body)
    restore()
    window.addEventListener('scroll', persistPosition, { passive: true })
    window.addEventListener('wheel', finish, { passive: true })
    window.addEventListener('touchmove', finish, { passive: true })
    return () => {
      clearTimeout(timeout)
      if (debounce) {
        clearTimeout(debounce)
        save({ [name]: last })
      }
      observer.disconnect()
      window.removeEventListener('scroll', persistPosition)
      window.removeEventListener('wheel', finish)
      window.removeEventListener('touchmove', finish)
    }
  }, [pathname, ready, save])
}
