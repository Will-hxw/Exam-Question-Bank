'use client'

import { type RefObject, useEffect, useEffectEvent } from 'react'

export function useQuestionShortcuts(region: RefObject<HTMLElement | null>, onKey: (key: string) => boolean) {
  const handleKey = useEffectEvent((event: KeyboardEvent) => {
    const view = region.current
    if (!view || event.defaultPrevented || event.isComposing || event.repeat
      || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || document.hidden
      || view.closest('[hidden],[inert]') || !view.getClientRects().length || document.querySelector('dialog[open],[role="dialog"][aria-modal="true"]')) return
    const target = event.target instanceof Element ? event.target : document.activeElement
    if (target) {
      if (target.closest('input,textarea,select,a,[contenteditable]:not([contenteditable="false"])')) return
      if (target !== document.body && target !== document.documentElement && !view.contains(target)) return
      if (event.key === 'Enter' && target.closest('button,[role="button"]')) return
    }
    if (onKey(event.key)) event.preventDefault()
  })

  useEffect(() => {
    const listener = (event: KeyboardEvent) => handleKey(event)
    document.addEventListener('keydown', listener)
    return () => document.removeEventListener('keydown', listener)
  }, [])
}
