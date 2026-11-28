'use client'

import { type ReactNode, useEffect, useEffectEvent, useId, useRef } from 'react'
import { Button } from './button'

export function BottomDrawer({
  open,
  onClose,
  title,
  closeLabel,
  headerContent,
  children,
  className,
  bodyClassName,
}: {
  open: boolean
  onClose: () => void
  title?: string
  closeLabel: string
  headerContent?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const dismiss = useEffectEvent(onClose)

  useEffect(() => {
    const panel = dialog.current
    if (!open || !panel) return
    const desktop = window.matchMedia('(min-width: 1024px)')
    if (desktop.matches) { dismiss(); return }
    panel.showModal()
    const onResize = () => { if (desktop.matches) dismiss() }
    desktop.addEventListener('change', onResize)
    return () => {
      desktop.removeEventListener('change', onResize)
      panel.close()
    }
  }, [open])

  return (
    <dialog
      ref={dialog}
      className="drawer-overlay"
      aria-labelledby={titleId}
      onCancel={(event) => { event.preventDefault(); onClose() }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className={['drawer-panel', className].filter(Boolean).join(' ')}>
        <div className="pt-3 pb-1 flex justify-center shrink-0">
          <span className="w-9 h-1 rounded-full bg-handle" />
        </div>
        <div className={`px-5 pt-3 pb-4 flex ${headerContent ? 'items-start' : 'items-center'} justify-between gap-3 shrink-0`}>
          <div id={titleId}>{headerContent ?? <h2 className="font-serif m-0 text-drawer-title font-bold">{title}</h2>}</div>
          <Button variant="surface" size="sm" className="text-ink-secondary shrink-0" onClick={onClose}>
            {closeLabel}
          </Button>
        </div>
        <div className={`no-scrollbar min-h-0 overflow-y-auto overscroll-contain px-5 pb-8 ${bodyClassName ?? ''}`}>
          {children}
        </div>
      </div>
    </dialog>
  )
}
