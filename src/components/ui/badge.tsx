import type { ReactNode } from 'react'

export type BadgeTone = 'neutral' | 'canvas' | 'selected' | 'correct' | 'wrong' | 'missed'
export type BadgeSize = 'xs' | 'sm' | 'status'

const toneClassMap: Record<BadgeTone, string> = {
  neutral: 'bg-surface text-ink-secondary',
  canvas: 'bg-canvas text-ink-secondary',
  selected: 'bg-selected-fill text-selected-ink',
  correct: 'bg-correct-fill text-correct-ink',
  wrong: 'bg-wrong-fill text-wrong-ink',
  missed: 'bg-missed-fill text-missed-ink',
}

const sizeClassMap: Record<BadgeSize, string> = {
  xs: 'px-1.5 py-0.5 rounded-tag text-nano font-semibold',
  sm: 'px-2.5 py-1 rounded-tag text-xs font-medium',
  status: 'px-2 py-0.5 rounded-tag text-micro font-medium',
}

export function Badge({
  tone = 'neutral',
  size = 'sm',
  className,
  children,
}: {
  tone?: BadgeTone
  size?: BadgeSize
  className?: string
  children: ReactNode
}) {
  const classes = `inline-flex items-center shrink-0 ${toneClassMap[tone]} ${sizeClassMap[size]}${className ? ` ${className}` : ''}`
  return <span className={classes}>{children}</span>
}

export function UnreadDot({ size = 'md', className }: { size?: 'sm' | 'md'; className?: string }) {
  const dimension = size === 'sm' ? 'w-1.5 h-1.5' : 'w-2 h-2'
  return <span className={`${dimension} rounded-full bg-wrong-badge shrink-0${className ? ` ${className}` : ''}`} aria-hidden="true" />
}
