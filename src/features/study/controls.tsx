'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { type Explanation, letter, type Topic } from './api'

export function ChoicePicker<Value extends string | number>({ entries, value, fallback, label, alignEnd, onChange }: {
  entries: { value: Value; label: string }[]
  value: Value
  fallback: string
  label?: string
  alignEnd?: boolean
  onChange: (value: Value) => void
}) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const panel = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !panel.current?.contains(event.target)) setOpen(false)
    }
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
        trigger.current?.focus()
      }
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', keyboard)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', keyboard)
    }
  }, [open])

  const selected = entries.find((entry) => entry.value === value)?.label ?? fallback

  return (
    <div className={`topic-dropdown${alignEnd ? ' topic-dropdown-end' : ''}`} ref={panel}>
      <button type="button" className="topic-dropdown-btn" aria-label={label && `${label}，当前 ${selected}`}
        aria-expanded={open} aria-controls={open ? id : undefined} ref={trigger} onClick={() => setOpen(!open)}>
        <span>{selected}</span>
        <span className="topic-dropdown-arrow" aria-hidden="true" />
      </button>
      {open && <div className="topic-dropdown-panel open" id={id}>
        {entries.map((entry) => (
          <button key={entry.value} type="button" aria-pressed={value === entry.value} className={`topic-option${value === entry.value ? ' active' : ''}`}
            onClick={() => { onChange(entry.value); setOpen(false); trigger.current?.focus() }}>
            {entry.label}
          </button>
        ))}
      </div>}
    </div>
  )
}

export function TopicPicker({ topics, value, allowAll = false, onChange }: {
  topics: Topic[]
  value: string
  allowAll?: boolean
  onChange: (value: string) => void
}) {
  const entries = topics.map(({ id, name }) => ({ value: id, label: name }))
  if (allowAll) entries.unshift({ value: '', label: '全部' })
  return <ChoicePicker entries={entries} value={value} fallback={allowAll ? '全部' : '请选择'} onChange={onChange} />
}

export function LoadMessage({ error, loading, empty, retry }: { error?: string | null; loading?: boolean; empty?: string; retry?: () => void }) {
  return <div className="empty-state" role={error ? 'alert' : 'status'}>
    <p>{error || (loading ? '加载中…' : empty || '暂无题目')}</p>
    {error && retry && <button type="button" className="btn btn-sm" onClick={retry}>重试</button>}
  </div>
}

export function ExplanationPanel({ content, onClose }: { content: Explanation; onClose?: () => void }) {
  return (
    <section className="explanation-panel" aria-label="题目解析">
      <h2>题目解析 {onClose && <button type="button" className="btn btn-sm" onClick={onClose}>收起</button>}</h2>
      <p>{content.explanation}</p>
      <ul>
        {content.options.map((option, index) => <li key={option.id}>
          <strong>{letter(index)}. {option.text}</strong>（{content.answerIds.includes(option.id) ? '正确' : '错误'}）{option.rationale && <p>{option.rationale}</p>}
        </li>)}
      </ul>
      {content.sources.length > 0 && <div className="explanation-sources">
        <p>参考出处</p>
        <ul>{content.sources.map((source, index) => <li key={`${source.url}-${index}`}>
          {/^https?:\/\//i.test(source.url) ? <a href={source.url} target="_blank" rel="noreferrer">{source.title}</a> : source.title}
          {source.location && ` · ${source.location}`}
        </li>)}</ul>
      </div>}
    </section>
  )
}
