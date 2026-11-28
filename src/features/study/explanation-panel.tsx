import { Button } from '@/components/ui'
import { messages } from '@/config/messages'
import type { Explanation } from './api'

export function ExplanationPanel({
  content,
  explanation,
  title = messages.explanation.defaultTitle,
  empty = messages.explanation.defaultEmpty,
  hideHeading = false,
  className = '',
}: {
  content?: Partial<Explanation> | null
  explanation?: string | null
  title?: string
  empty?: string
  hideHeading?: boolean
  className?: string
}) {
  const text = (content?.explanation ?? explanation)?.trim()
  const sources = content?.sources ?? []
  return (
    <div className={className} aria-label={title}>
      {!hideHeading && <div className="text-xs font-medium text-ink-muted mb-1.5">{title}</div>}
      <p className="m-0 text-body text-ink-secondary leading-relaxed whitespace-pre-wrap">{text || empty}</p>
      {sources.length > 0 && (
        <ul className="m-0 mt-2.5 pl-4 text-xs text-ink-muted flex flex-col gap-1">
          {sources.map((source) => (
            <li key={`${source.url}:${source.location}`}>
              {source.url ? (
                <a className="underline hover:text-ink-primary" href={source.url} target="_blank" rel="noreferrer">
                  {source.title}
                </a>
              ) : source.title}
              {source.location ? ` · ${source.location}` : ''}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function LoadMessage({
  loading = false,
  error = '',
  empty = '',
  retry,
  action,
}: {
  loading?: boolean
  error?: string | null
  empty?: string
  retry?: () => void
  action?: React.ReactNode
}) {
  if (loading) {
    return <p className="py-10 text-center text-sm text-ink-muted" role="status">{messages.common.loading}</p>
  }
  if (error) {
    return (
      <div className="p-5 rounded-option bg-wrong-fill text-wrong-ink flex items-center justify-between gap-3 flex-wrap" role="alert">
        <span className="text-sm">{error}</span>
        {retry && (
          <Button variant="surface" size="xs" className="bg-canvas text-ink-primary" onClick={retry}>
            {messages.common.retry}
          </Button>
        )}
      </div>
    )
  }
  if (empty) {
    return (
      <div className="py-12 text-center flex flex-col items-center gap-3">
        <p className="m-0 text-sm text-ink-muted">{empty}</p>
        {action}
      </div>
    )
  }
  return null
}
