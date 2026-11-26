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
  let value: T | null = null
  if (snapshot !== null) {
    try { value = decode(JSON.parse(snapshot)) } catch { /* Ignore damaged drafts. */ }
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

  return { value, snapshot, save, clear: (expected: string | null) => {
    if (read(key) === expected) save(null)
  } }
}
