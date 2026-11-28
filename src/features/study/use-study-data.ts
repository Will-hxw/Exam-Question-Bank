'use client'

import { useEffect, useState } from 'react'
import { bankReleaseEvent, cachedPublic, readPublic, requestJson, StudyRequestError } from './api'

type DataState<T> = { key: string; path: string | null; data: T | null; error: string | null }

export function createPersonalStudyReads(userId: string) {
  const entries = new Map<string, { value?: unknown; expires: number; request: Promise<unknown> }>()
  return {
    peek<T>(path: string): T | undefined {
      const entry = entries.get(path)
      return entry?.value as T | undefined
    },
    load<T>(path: string): Promise<T> {
      const existing = entries.get(path)
      if (existing && existing.expires > Date.now()) return existing.request as Promise<T>
      const entry = {
        value: existing?.value,
        expires: Infinity,
        request: requestJson<T>(path, { headers: { 'X-Study-Account': userId } }).then((value) => {
          entry.value = value
          entry.expires = Date.now() + 15_000
          return value
        }, (error: unknown) => {
          if (entries.get(path) === entry) entries.delete(path)
          throw error
        }),
      }
      entries.delete(path)
      entries.set(path, entry)
      if (entries.size > 24) entries.delete(entries.keys().next().value!)
      return entry.request
    },
    invalidate() { entries.clear() },
  }
}

export function useStudyData<T>(path: string | null, revision = 0, {
  keepPreviousData = false, load, peek, initial,
}: {
  keepPreviousData?: boolean
  load?: (path: string) => Promise<T>
  peek?: (path: string) => T | undefined
  initial?: T | null | Promise<T | null>
} = {}) {
  const [retry, setRetry] = useState<{ count: number; override?: { path: string; load: (path: string) => Promise<T> } }>({ count: 0 })
  const key = `${path}:${retry.count}:${revision}`
  const freshLoad = retry.override?.path === path ? retry.override.load : undefined
  const bootstrap = revision === 0 && retry.count === 0 ? initial : undefined
  const syncInitial = bootstrap !== undefined && bootstrap !== null && !(bootstrap instanceof Promise) ? bootstrap : undefined
  const [state, setState] = useState<DataState<T>>(() => {
    if (syncInitial !== undefined) return { key, path, data: syncInitial, error: null }
    const cached = path ? peek?.(path) ?? (path.startsWith('/api/public/') ? cachedPublic<T>(path) : undefined) : undefined
    return { key: cached === undefined ? '' : key, path, data: cached ?? null, error: null }
  })

  useEffect(() => {
    if (!path?.startsWith('/api/public/')) return
    const refresh = () => setRetry((current) => ({ ...current, count: current.count + 1 }))
    window.addEventListener(bankReleaseEvent, refresh)
    return () => window.removeEventListener(bankReleaseEvent, refresh)
  }, [path])

  useEffect(() => {
    if (!path) return
    if (syncInitial !== undefined && state.key === key && state.data === syncInitial) return
    let active = true
    const get = freshLoad ?? load ?? (path.startsWith('/api/public/') ? readPublic<T> : requestJson<T>)
    const request = bootstrap ? Promise.resolve(bootstrap).then((value) => value ?? get(path)) : get(path)
    void request.then((data) => {
      if (active) setState({ key, path, data, error: null })
    }, (error: unknown) => {
      const message = error instanceof StudyRequestError ? error.message : '连接失败，请检查网络后重试。'
      if (active) setState({ key, path, data: null, error: message })
    })
    return () => { active = false }
  }, [bootstrap, key, path, load, freshLoad, state.data, state.key, syncInitial])

  const current = state.key === key
  const snapshot = !current && path && !freshLoad ? peek?.(path) ?? (path.startsWith('/api/public/') ? cachedPublic<T>(path) : undefined) : undefined
  return {
    data: current ? state.data : snapshot ?? (keepPreviousData && path === state.path ? state.data : null),
    error: current ? state.error : null,
    loading: Boolean(path && !current && snapshot === undefined),
    retry: () => setRetry((current) => ({ ...current, count: current.count + 1 })),
    reload: (load: (path: string) => Promise<T>) => {
      if (path) setRetry((current) => ({ count: current.count + 1, override: { path, load } }))
    },
  }
}

export function useDebouncedSearch(value: string) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timeout = setTimeout(() => setDebounced(value.trim()), 220)
    return () => clearTimeout(timeout)
  }, [value])
  return debounced
}
