'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { ChevronDownIcon } from '@/components/icons'
import { messages } from '@/config/messages'
import { type Topic } from './api'
export { ExplanationPanel, LoadMessage } from './explanation-panel'

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
    <div className="relative inline-block max-w-full" ref={panel}>
      <button
        type="button"
        className="btn-surface h-10 px-3.5 rounded-compact inline-flex items-center justify-between gap-2 text-control font-medium max-w-full"
        aria-label={label && messages.controls.pickerAria(label, selected)}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        ref={trigger}
        onClick={() => setOpen(!open)}
      >
        <span className="truncate">{selected}</span>
        <ChevronDownIcon className={`w-4 h-4 shrink-0 text-ink-secondary transition-transform duration-300 ease-silk ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div
          className={`dropdown-panel ${alignEnd ? 'right-0' : 'left-0'}`}
          id={id}
        >
          {entries.map((entry) => {
            const active = value === entry.value
            return (
              <button
                key={entry.value}
                type="button"
                aria-pressed={active}
                className={`tactile w-full text-left px-3 py-2.5 rounded-micro text-control leading-snug ${active ? 'bg-selected-fill text-selected-ink font-semibold' : 'bg-transparent text-ink-primary hover:bg-surface'}`}
                onClick={() => {
                  onChange(entry.value)
                  setOpen(false)
                  trigger.current?.focus()
                }}
              >
                {entry.label}
              </button>
            )
          })}
        </div>
      )}
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
  if (allowAll) entries.unshift({ value: '', label: messages.common.all })
  return <ChoicePicker entries={entries} value={value} fallback={allowAll ? messages.common.all : messages.common.choose} onChange={onChange} />
}
