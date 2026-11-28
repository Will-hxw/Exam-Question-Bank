import type { ReactNode } from 'react'

export type OptionCardState = 'idle' | 'selected' | 'correct' | 'wrong' | 'missed' | 'muted'

const rowStateClassMap: Record<OptionCardState, string> = {
  idle: 'bg-surface hover:bg-surface-hover',
  selected: 'bg-selected-fill',
  correct: 'bg-correct-fill animate-pop-correct',
  wrong: 'bg-wrong-fill animate-shake-wrong',
  missed: 'bg-missed-fill',
  muted: 'bg-surface',
}

const badgeStateClassMap: Record<OptionCardState, string> = {
  idle: 'bg-surface-badge text-ink-primary',
  selected: 'bg-selected-badge text-white',
  correct: 'bg-correct-badge text-white',
  wrong: 'bg-wrong-badge text-white',
  missed: 'bg-missed-badge text-white',
  muted: 'bg-surface-badge text-ink-secondary',
}

const textStateClassMap: Record<OptionCardState, string> = {
  idle: 'text-ink-primary',
  selected: 'text-selected-ink',
  correct: 'text-correct-ink',
  wrong: 'text-wrong-ink',
  missed: 'text-missed-ink',
  muted: 'text-ink-secondary',
}

export function OptionCard({
  letter,
  text,
  state,
  staggerIndex,
  indicator,
  disabled,
  pressed,
  onClick,
  className,
}: {
  letter: string
  text: string
  state: OptionCardState
  staggerIndex: number
  indicator?: ReactNode
  disabled?: boolean
  pressed?: boolean
  onClick?: () => void
  className?: string
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={pressed}
      onClick={onClick}
      className={`group option-row animate-option-in stagger-${staggerIndex} ${rowStateClassMap[state]}${className ? ` ${className}` : ''}`}
    >
      <span className="flex items-center gap-3.5 min-w-0">
        <span className={`option-badge ${badgeStateClassMap[state]}`}>
          {letter}
        </span>
        <span className={`text-option font-medium break-words ${textStateClassMap[state]}`}>
          {text}
        </span>
      </span>
      {indicator}
    </button>
  )
}
