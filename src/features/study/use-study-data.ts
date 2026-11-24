'use client'

import { useEffect, useState } from 'react'
import { bankReleaseEvent, cachedPublic, readPublic, requestJson, StudyRequestError } from './api'

type DataState<T> = { key: string; path: string | null; data: T | null; error: string | null }

export function useStudyData<T>(path: string | null, revision = 0, {
  keepPreviousData = false, load,
}: { keepPreviousData?: boolean; load?: (path: string) => Promise<T> } = {}) {
  const [retryCount, setRetryCount] = useState(0)
  const key = `${path}:${retryCount}:${revision}`
  const [state, setState] = useState<DataState<T>>(() => {
    const cached = path?.startsWith('/api/public/') ? cachedPublic<T>(path) : undefined
    return { key: cached === undefined ? '' : key, path, data: cached ?? null, error: null }
  })

  useEffect(() => {
    if (!path?.startsWith('/api/public/')) return
    const refresh = () => setRetryCount((count) => count + 1)
    window.addEventListener(bankReleaseEvent, refresh)
    return () => window.removeEventListener(bankReleaseEvent, refresh)
  }, [path])

  useEffect(() => {
    if (!path) return
    let active = true
    const get = load ?? (path.startsWith('/api/public/') ? readPublic<T> : requestJson<T>)
    void get(path).then((data) => {
      if (active) setState({ key, path, data, error: null })
    }, (error: unknown) => {
      const message = error instanceof StudyRequestError ? error.message : '连接失败，请检查网络后重试。'
      if (active) setState({ key, path, data: null, error: message })
    })
    return () => { active = false }
  }, [key, path, load])

  const current = state.key === key
  return {
    data: current || (keepPreviousData && path === state.path) ? state.data : null,
    error: current ? state.error : null,
    loading: Boolean(path && !current),
    retry: () => setRetryCount((count) => count + 1),
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
