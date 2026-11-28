import type { ReactNode } from 'react'

export function StatTile({
  label,
  value,
  valueClassName,
  align = 'left',
  size = 'md',
  className,
}: {
  label: string
  value: ReactNode
  valueClassName?: string
  align?: 'left' | 'center'
  size?: 'md' | 'lg'
  className?: string
}) {
  const alignCls = align === 'center' ? 'text-center' : ''
  const valueSizeCls = size === 'lg' ? 'text-xl' : 'text-lg'
  const labelMarginCls = size === 'lg' ? 'mt-0.5' : ''
  return (
    <div className={`stat-tile ${alignCls}${className ? ` ${className}` : ''}`}>
      <div className={`${valueSizeCls} font-bold tabular-nums${valueClassName ? ` ${valueClassName}` : ''}`}>
        {value}
      </div>
      <div className={`text-xs text-ink-secondary${labelMarginCls ? ` ${labelMarginCls}` : ''}`}>
        {label}
      </div>
    </div>
  )
}
