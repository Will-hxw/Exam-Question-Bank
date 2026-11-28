import type { ReactNode } from 'react'

export function CollapsePanel({
  open,
  children,
  className,
  contentClassName,
}: {
  open: boolean
  children: ReactNode
  className?: string
  contentClassName?: string
}) {
  return (
    <div
      className={`collapse-grid ${open ? 'collapse-open' : 'grid-rows-collapsed'}${className ? ` ${className}` : ''}`}
      aria-hidden={!open}
      inert={!open}
    >
      <div className={`collapse-inner${contentClassName ? ` ${contentClassName}` : ''}`}>
        {children}
      </div>
    </div>
  )
}
