'use client'

import { useCallback, useEffect, useEffectEvent, useRef, useState, useSyncExternalStore } from 'react'
import { questionUrl, requestJson } from './api'
import type { LibraryList, LibraryView } from './library-view'
export { libraryPageSizes, readLibraryView, type LibraryList, type LibraryView } from './library-view'

export type StudyPreferences = Record<string, unknown>

function libraryFields(value: unknown) {
  return (value && typeof value === 'object' && !Array.isArray(value) ? value : {}) as Record<string, unknown>
}

function mergePreferences(values: StudyPreferences, edits: StudyPreferences): StudyPreferences {
  const merged = { ...values }
  for (const [name, value] of Object.entries(edits)) {
    merged[name] = name.startsWith('library:') ? { ...libraryFields(merged[name]), ...libraryFields(value) } : value
  }
  return merged
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

export function readStudyPreference(key: string): unknown {
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
  const hydrated = useStudyPreferencesReady()
  const stored = hydrated
    ? (readStudyPreference(key) as { values?: StudyPreferences; pending?: StudyPreferences } | undefined)
    : undefined
  const [confirmed, setConfirmed] = useState<StudyPreferences>({})
  const [lastRemote, setLastRemote] = useState(remote)
  const [pending, setPending] = useState<StudyPreferences>({})
  const [syncFailed, setSyncFailed] = useState(false)
  const queue = useRef<StudyPreferences>({})
  const cache = useRef<StudyPreferences>(remote ?? {})
  const active = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hydratedRefs = useRef(false)

  useEffect(() => {
    if (!hydrated || hydratedRefs.current) return
    hydratedRefs.current = true
    const local = readStudyPreference(key) as { values?: StudyPreferences; pending?: StudyPreferences } | undefined
    if (!local) return
    if (local.pending) queue.current = mergePreferences(local.pending, queue.current)
    if (local.values) cache.current = mergePreferences(local.values, cache.current)
  }, [hydrated, key])

  if (remote && remote !== lastRemote) {
    setLastRemote(remote)
    setConfirmed((previous) => Object.fromEntries(Object.entries(previous).filter(([name]) => !name.startsWith('library:'))))
  }

  const persist = useCallback(() => writeStudyPreference(key, { values: cache.current, pending: queue.current }), [key])
  const flush = useCallback(async (keepalive = false) => {
    if (active.current || !navigator.onLine || !Object.keys(queue.current).length) return
    active.current = true
    try {
      while (Object.keys(queue.current).length) {
        const batch = Object.fromEntries(Object.entries(queue.current).slice(0, 32))
        const saved = await requestJson<{ preferences?: StudyPreferences }>('/api/me/preferences', {
          method: 'PUT', keepalive, headers: { 'Content-Type': 'application/json', 'X-Study-Account': userId },
          body: JSON.stringify(batch),
        })
        for (const [name, value] of Object.entries(batch)) {
          if (queue.current[name] === value) delete queue.current[name]
          else if (name.startsWith('library:')) {
            const sent = libraryFields(value)
            const rest = Object.fromEntries(Object.entries(libraryFields(queue.current[name])).filter(([field, next]) => next !== sent[field]))
            if (Object.keys(rest).length) queue.current[name] = rest
            else delete queue.current[name]
          }
        }
        const acknowledged = saved.preferences ?? batch
        cache.current = mergePreferences(mergePreferences(cache.current, acknowledged), queue.current)
        setConfirmed((previous) => mergePreferences(previous, acknowledged))
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
    cache.current = mergePreferences(mergePreferences(remote, confirmed), queue.current)
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
    queue.current = mergePreferences(queue.current, edits)
    cache.current = mergePreferences(cache.current, edits)
    setPending({ ...queue.current })
    persist()
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => { void flush() }, 400)
  }, [flush, persist])

  return {
    values: hydrated ? mergePreferences(mergePreferences(remote ?? stored?.values ?? {}, confirmed), { ...stored?.pending, ...pending }) : (remote ?? {}),
    ready: remote !== undefined || (hydrated && (stored?.values !== undefined || !loading)),
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
