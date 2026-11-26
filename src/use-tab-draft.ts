'use client'

import { useSyncExternalStore } from 'react'

const changes = 'cqu-tab-draft-change'
const fallback = new Map<string, string | null>()
const empty = () => null

function subscribe(change: () => void) {
  window.addEventListener(changes, change)
  return () => window.removeEventListener(changes, change)
}

function read(key: string) {
  if (fallback.has(key)) return fallback.get(key) ?? null
  try { return sessionStorage.getItem(key) } catch { return null }
}

export function useTabDraft<T>(key: string, decode: (value: unknown) => T | null) {
  const snapshot = useSyncExternalStore(subscribe, () => read(key), empty)
  function parse(raw: string | null) {
    if (raw === null) return null
    try { return decode(JSON.parse(raw)) } catch { return null }
  }

  function save(draft: T | null) {
    const next = draft === null ? null : JSON.stringify(draft)
    try {
      if (next === null) sessionStorage.removeItem(key)
      else sessionStorage.setItem(key, next)
      fallback.delete(key)
    } catch {
      fallback.set(key, next)
    }
    window.dispatchEvent(new Event(changes))
    return next
  }

  return { value: parse(snapshot), snapshot, save, update: (transform: (current: T | null) => T | null) => {
    return save(transform(parse(read(key))))
  }, clear: (expected: string | null) => {
    if (read(key) === expected) save(null)
  } }
}
