/**
 * Shared linear icon library with centralized dimensions and stroke widths.
 */

const iconViewBox = '0 0 24 24'
const chevronViewBox = '0 0 20 20'

const iconSizes = {
  sm: 14,
  bookmark: 17,
  standard: 18,
  composer: 19,
  mailboxDefault: 20,
} as const

const iconStrokes = {
  eye: 1.6,
  composer: 1.65,
  nav: 1.75,
  chevron: 1.8,
  feedback: 2.2,
} as const

export function SunIcon() {
  return (
    <svg aria-hidden="true" width={iconSizes.standard} height={iconSizes.standard} viewBox={iconViewBox} fill="none" stroke="currentColor" strokeWidth={iconStrokes.nav} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
    </svg>
  )
}

export function MoonIcon() {
  return (
    <svg aria-hidden="true" width={iconSizes.standard} height={iconSizes.standard} viewBox={iconViewBox} fill="none" stroke="currentColor" strokeWidth={iconStrokes.nav} strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  )
}

export function ChatBubbleIcon() {
  return (
    <svg aria-hidden="true" width={iconSizes.standard} height={iconSizes.standard} viewBox={iconViewBox} fill="none" stroke="currentColor" strokeWidth={iconStrokes.nav} strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
  )
}

export function UserIcon() {
  return (
    <svg aria-hidden="true" width={iconSizes.standard} height={iconSizes.standard} viewBox={iconViewBox} fill="none" stroke="currentColor" strokeWidth={iconStrokes.nav} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="3.8" />
      <path d="M5 19.5c1.4-3.2 4-5 7-5s5.6 1.8 7 5" />
    </svg>
  )
}

export function OverviewIcon() {
  return (
    <svg aria-hidden="true" width={iconSizes.standard} height={iconSizes.standard} viewBox={iconViewBox} fill="none" stroke="currentColor" strokeWidth={iconStrokes.nav} strokeLinecap="round">
      <path d="M5 19V11m7 8V5m7 14v-9" />
    </svg>
  )
}

export function SponsorIcon() {
  return (
    <svg aria-hidden="true" width={iconSizes.standard} height={iconSizes.standard} viewBox={iconViewBox} fill="none" stroke="currentColor" strokeWidth={iconStrokes.nav} strokeLinejoin="round">
      <path d="M20.3 5.9a5 5 0 0 0-7.1 0L12 7.2l-1.2-1.3a5 5 0 0 0-7.1 7.1L12 21l8.3-8a5 5 0 0 0 0-7.1Z" />
    </svg>
  )
}

export function ChevronDownIcon({ className = 'w-4 h-4 shrink-0 text-ink-secondary' }: { className?: string }) {
  return (
    <svg aria-hidden="true" className={className} viewBox={chevronViewBox} fill="none" stroke="currentColor" strokeWidth={iconStrokes.chevron}>
      <path d="M5.5 7.5L10 12L14.5 7.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function BookmarkIcon({ filled }: { filled: boolean }) {
  return (
    <svg aria-hidden="true" width={iconSizes.bookmark} height={iconSizes.bookmark} viewBox={iconViewBox} fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={iconStrokes.nav} strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
    </svg>
  )
}

export function CheckIcon({ animated = false }: { animated?: boolean }) {
  return (
    <svg aria-hidden="true" width={iconSizes.standard} height={iconSizes.standard} viewBox={iconViewBox} fill="none" stroke="currentColor" strokeWidth={iconStrokes.feedback} strokeLinecap="round" strokeLinejoin="round">
      <path className={animated ? 'animate-check-draw' : undefined} d="M20 6L9 17l-5-5" />
    </svg>
  )
}

export function CrossIcon() {
  return (
    <svg aria-hidden="true" width={iconSizes.standard} height={iconSizes.standard} viewBox={iconViewBox} fill="none" stroke="currentColor" strokeWidth={iconStrokes.feedback} strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  )
}

export function BackArrowIcon() {
  return (
    <svg aria-hidden="true" width={iconSizes.standard} height={iconSizes.standard} viewBox={iconViewBox} fill="none" stroke="currentColor" strokeWidth={iconStrokes.chevron} strokeLinecap="round" strokeLinejoin="round">
      <path d="m14 6-6 6 6 6" />
    </svg>
  )
}

export function EditPencilIcon() {
  return (
    <svg aria-hidden="true" width={iconSizes.sm} height={iconSizes.sm} viewBox={iconViewBox} fill="none" stroke="currentColor" strokeWidth={iconStrokes.chevron} strokeLinecap="round" strokeLinejoin="round">
      <path d="m15 5 4 4M4 20l4-.8L20 7a2.8 2.8 0 0 0-4-4L4.8 15Z" />
    </svg>
  )
}

export function EmojiIcon() {
  return (
    <svg aria-hidden="true" width={iconSizes.composer} height={iconSizes.composer} viewBox={iconViewBox} fill="none" stroke="currentColor" strokeWidth={iconStrokes.composer} strokeLinecap="round">
      <circle cx="12" cy="12" r="8.8" />
      <path d="M8.3 14.2a4 4 0 0 0 7.4 0M9 9.1h.1m5.8 0h.1" />
    </svg>
  )
}

export function MentionIcon() {
  return (
    <svg aria-hidden="true" width={iconSizes.composer} height={iconSizes.composer} viewBox={iconViewBox} fill="none" stroke="currentColor" strokeWidth={iconStrokes.composer} strokeLinecap="round">
      <circle cx="12" cy="12" r="3.5" />
      <path d="M15.5 8.5v4.85a2.65 2.65 0 0 0 5.3 0V12a8.8 8.8 0 1 0-3.52 7.04" />
    </svg>
  )
}

export function EyeIcon({ visible }: { visible: boolean }) {
  return (
    <svg aria-hidden="true" width={iconSizes.standard} height={iconSizes.standard} viewBox={iconViewBox} fill="none" stroke="currentColor" strokeWidth={iconStrokes.eye} strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12s3.64-6 10-6 10 6 10 6-3.64 6-10 6S2 12 2 12Z" />
      <circle cx="12" cy="12" r="2.5" />
      {visible && <path d="M4 4l16 16" />}
    </svg>
  )
}

export function MailboxIcon({ size = iconSizes.mailboxDefault }: { size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox={iconViewBox} fill="none" stroke="currentColor" strokeWidth={iconStrokes.composer} strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 20v-7a6 6 0 0 1 6-6h6a6 6 0 0 1 6 6v7H3Z" />
      <path d="M9 7a6 6 0 0 1 6 6v7M6.5 14h5M17 7V3h4" />
    </svg>
  )
}
