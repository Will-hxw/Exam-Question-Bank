import type { ReactNode } from 'react'
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
  return (
    <div
      className={`drawer-overlay lg:hidden ${open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
      aria-hidden={!open}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className={`drawer-panel ${open ? 'translate-y-0' : 'translate-y-full'}${className ? ` ${className}` : ''}`}>
        <div className="pt-3 pb-1 flex justify-center shrink-0">
          <span className="w-9 h-1 rounded-full bg-handle" />
        </div>
        <div className={`px-5 pt-3 pb-4 flex ${headerContent ? 'items-start' : 'items-center'} justify-between gap-3 shrink-0`}>
          {headerContent ?? (
            <h2 className="font-serif m-0 text-drawer-title font-bold">{title}</h2>
          )}
          <Button variant="surface" size="sm" className="text-ink-secondary shrink-0" onClick={onClose}>
            {closeLabel}
          </Button>
        </div>
        <div className={`no-scrollbar overflow-y-auto px-5 pb-8${bodyClassName ? ` ${bodyClassName}` : ''}`}>
          {children}
        </div>
      </div>
    </div>
  )
}
