'use client'

import { useEffect, useRef, useState } from 'react'
import { type Explanation, letter, type Topic } from './api'

export function TopicPicker({ topics, value, allowAll = false, onChange }: {
  topics: Topic[]
  value: string
  allowAll?: boolean
  onChange: (value: string) => void
}) {
  const [open, setOpen] = useState(false)
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

  const hasTopic = topics.some((topic) => topic.id === value)
  const entries = allowAll ? [{ id: '', name: '全部', count: 0 }, ...topics] : topics

  return (
    <div className="topic-dropdown" ref={panel}>
      <button type="button" className="topic-dropdown-btn" aria-expanded={open} ref={trigger} onClick={() => setOpen(!open)}>
        <span>{hasTopic ? topics.find((topic) => topic.id === value)?.name : allowAll ? '全部' : '请选择'}</span>
        <span className="topic-dropdown-arrow" aria-hidden="true" />
      </button>
      {open && <div className="topic-dropdown-panel open">
        {entries.map((topic) => (
          <button key={topic.id || 'all'} type="button" aria-pressed={value === topic.id} className={`topic-option${value === topic.id ? ' active' : ''}`}
            onClick={() => { onChange(topic.id); setOpen(false); trigger.current?.focus() }}>
            {topic.name}
          </button>
        ))}
      </div>}
    </div>
  )
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
