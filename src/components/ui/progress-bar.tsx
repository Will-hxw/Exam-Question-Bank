export function ProgressBar({
  percent,
  variant = 'pill',
  ariaLabel,
  valueNow,
  valueMax,
  className,
}: {
  percent: number
  variant?: 'pill' | 'full'
  ariaLabel?: string
  valueNow?: number
  valueMax?: number
  className?: string
}) {
  const clamped = Math.max(0, Math.min(100, percent))
  const trackCls = variant === 'pill'
    ? 'progress-pill'
    : 'w-full h-1.5 rounded-full overflow-hidden bg-progress-track'
  const fillCls = variant === 'pill'
    ? 'progress-fill-bar'
    : 'h-full bg-selected-badge rounded-full transition-progress'

  return (
    <div
      className={`${trackCls}${className ? ` ${className}` : ''}`}
      role={ariaLabel ? 'progressbar' : undefined}
      aria-label={ariaLabel}
      aria-valuenow={ariaLabel ? valueNow : undefined}
      aria-valuemin={ariaLabel ? 0 : undefined}
      aria-valuemax={ariaLabel ? valueMax : undefined}
    >
      <div className={fillCls} style={{ width: `${clamped}%` }} />
    </div>
  )
}
