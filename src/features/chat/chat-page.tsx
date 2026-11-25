'use client'

import Image from 'next/image'
import { type FormEvent, type MouseEventHandler, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { messageLimit, nicknameLimit, type ChatMessage } from './types'
import { chatError, useChatRoom } from './use-chat-room'
import './chat.css'

const emojis = ['😀', '😂', '🥹', '🤣', '😎', '🤔', '🙃', '👀', '👍', '👏', '🙌', '🤝', '❤️', '✨', '🎉', '💪']
const time = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
const date = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric' })

function messageTime(value: string) {
  const sent = new Date(value)
  return `${sent.toDateString() === new Date().toDateString() ? '今天' : date.format(sent)} ${time.format(sent)}`
}

function Avatar({ avatar, size }: { avatar: number; size: number }) {
  return <Image className="chat-avatar" src={`/chat-avatars/${avatar}.webp`} alt="" width={size} height={size} unoptimized />
}

function Message({ message, previous }: { message: ChatMessage; previous?: ChatMessage }) {
  const gap = previous ? Date.parse(message.sentAt) - Date.parse(previous.sentAt) : Infinity
  return <li className="chat-message" data-message-id={message.id}>
    {gap >= 5 * 60 * 1000 && <time className="chat-timestamp" dateTime={message.sentAt}>{messageTime(message.sentAt)}</time>}
    <div className={`chat-message-row${message.mine ? ' is-mine' : ''}`}>
      <Avatar avatar={message.avatar} size={36} />
      <div className="chat-message-content">
        <span className="chat-nickname">{message.nickname}</span>
        <p className="chat-bubble" dir="auto">{message.body}</p>
      </div>
    </div>
  </li>
}

export default function ChatPage({ pathname, userId, onBack }: {
  pathname: string
  userId: string
  onBack: MouseEventHandler<HTMLAnchorElement>
}) {
  const room = useChatRoom(userId)
  const section = useRef<HTMLElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const composer = useRef<HTMLTextAreaElement>(null)
  const emojiButton = useRef<HTMLButtonElement>(null)
  const nicknameInput = useRef<HTMLInputElement>(null)
  const nicknameButton = useRef<HTMLButtonElement>(null)
  const nearBottom = useRef(true)
  const prepend = useRef<{ element: HTMLElement; offset: number } | null>(null)
  const newestSeen = useRef<string | undefined>(undefined)
  const pending = useRef<{ body: string; id: string } | null>(null)
  const [newMessages, setNewMessages] = useState(false)
  const [editingName, setEditingName] = useState(false)
  const [nickname, setNickname] = useState('')
  const [savingName, setSavingName] = useState(false)
  const [nameError, setNameError] = useState('')
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState('')
  const [showEmoji, setShowEmoji] = useState(false)

  useEffect(() => {
    heading.current?.focus({ preventScroll: true })
    section.current?.scrollIntoView({ block: 'start' })
  }, [])
  useEffect(() => { if (editingName) nicknameInput.current?.focus() }, [editingName])

  function scrollToLatest() {
    if (list.current) list.current.scrollTop = list.current.scrollHeight
    nearBottom.current = true
    setNewMessages(false)
  }

  useLayoutEffect(() => {
    const log = list.current
    if (!log) return
    const last = room.messages.at(-1)?.id
    const anchor = prepend.current
    prepend.current = null
    if (anchor && log.contains(anchor.element)) {
      log.scrollTop += anchor.element.getBoundingClientRect().top - anchor.offset
    } else if (nearBottom.current) {
      log.scrollTop = log.scrollHeight
    }
    if (last && last !== newestSeen.current && !nearBottom.current) {
      // Keep the reader's scroll position while older messages are in view.
      setNewMessages(true)
    }
    newestSeen.current = last
  }, [room.messages])

  function rememberHistoryPosition() {
    const log = list.current
    if (!log) return
    const top = log.getBoundingClientRect().top
    const firstVisible = [...log.querySelectorAll<HTMLElement>('[data-message-id]')]
      .find((item) => item.getBoundingClientRect().bottom > top)
    if (firstVisible) prepend.current = { element: firstVisible, offset: firstVisible.getBoundingClientRect().top }
  }

  function closeNickname() {
    setEditingName(false)
    nicknameButton.current?.focus()
  }

  async function saveNickname(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (savingName || !nickname.trim()) return
    setSavingName(true)
    setNameError('')
    try {
      await room.rename(nickname)
      closeNickname()
    } catch (error) {
      setNameError(chatError(error, '昵称未保存，请重试。'))
    } finally {
      setSavingName(false)
    }
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const body = draft.trim()
    if (!room.profile || !body || sending) return
    if (pending.current?.body !== body) pending.current = { body, id: crypto.randomUUID() }
    setSending(true)
    setSendError('')
    setShowEmoji(false)
    try {
      await room.send(body, pending.current.id)
      pending.current = null
      setDraft('')
      scrollToLatest()
    } catch (error) {
      setSendError(chatError(error, '发送未获确认，请检查网络后再试。'))
    } finally {
      setSending(false)
    }
  }

  function insertEmoji(emoji: string) {
    const input = composer.current
    if (!input) return
    const { selectionStart, selectionEnd } = input
    const next = draft.slice(0, selectionStart) + emoji + draft.slice(selectionEnd)
    if (next.length > messageLimit) return
    setDraft(next)
    setShowEmoji(false)
    requestAnimationFrame(() => {
      input.focus()
      input.setSelectionRange(selectionStart + emoji.length, selectionStart + emoji.length)
    })
  }

  return <section className="chat-room" ref={section} aria-labelledby="chat-title">
    <header className="chat-header">
      <a className="chat-icon-button chat-back" href={pathname} onClick={onBack} aria-label="返回练习" title="返回练习">
        <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m14 6-6 6 6 6" /></svg>
      </a>
      <h1 id="chat-title" ref={heading} tabIndex={-1}>聊天区</h1>
      {room.profile && <button type="button" className="chat-profile" ref={nicknameButton} aria-label="修改昵称"
        aria-controls="chat-edit-name" aria-expanded={editingName} onClick={() => {
          if (editingName) {
            if (!savingName) closeNickname()
            return
          }
          setNickname(room.profile!.nickname)
          setNameError('')
          setEditingName(true)
        }}>
        <Avatar avatar={room.profile.avatar} size={30} />
        <span>{room.profile.nickname}</span>
        <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m15 5 4 4M4 20l4-.8L20 7a2.8 2.8 0 0 0-4-4L4.8 15Z" /></svg>
      </button>}
    </header>
    {editingName && <form id="chat-edit-name" className="chat-name-form" onSubmit={saveNickname}
      onKeyDown={(event) => { if (event.key === 'Escape' && !savingName && !event.nativeEvent.isComposing) closeNickname() }}>
      <label htmlFor="chat-nickname">聊天昵称</label>
      <input id="chat-nickname" ref={nicknameInput} value={nickname} onChange={(event) => setNickname(event.target.value)}
        maxLength={nicknameLimit} readOnly={savingName} required />
      <button className="btn btn-sm" type="button" disabled={savingName} onClick={closeNickname}>取消</button>
      <button className="btn btn-sm primary" type="submit" disabled={savingName || !nickname.trim()}>保存</button>
      {nameError && <p className="chat-error" role="alert">{nameError}</p>}
    </form>}
    {room.readError && <div className="chat-sync" role="status">
      {room.readError} <button className="chat-text-button" type="button" onClick={room.retry}>重试</button>
    </div>}
    <div className="chat-timeline">
      <div className="chat-log" ref={list} role="region" aria-label="聊天记录" tabIndex={0} onScroll={() => {
        const log = list.current
        if (!log) return
        nearBottom.current = log.scrollHeight - log.clientHeight - log.scrollTop < 64
        if (nearBottom.current) setNewMessages(false)
      }}>
        {room.hasOlder && <div className="chat-history">
          <button className="chat-text-button" type="button" onClick={() => void room.loadOlder(rememberHistoryPosition)}
            disabled={room.loadingOlder}>{room.loadingOlder ? '正在加载…' : '查看更早消息'}</button>
          {room.historyError && <p className="chat-error" role="alert">{room.historyError}</p>}
        </div>}
        {room.messages.length > 0 ? <ol className="chat-message-list">
          {room.messages.map((message, index) => <Message key={message.id} message={message} previous={room.messages[index - 1]} />)}
        </ol> : !room.profile && !room.readError && <p className="chat-loading" role="status">正在加载聊天记录…</p>}
      </div>
      {newMessages && <button type="button" className="chat-latest" onClick={scrollToLatest}>↓ 查看新消息</button>}
    </div>
    <form className="chat-composer" onSubmit={sendMessage} onKeyDown={(event) => {
      if (event.key === 'Escape' && showEmoji) {
        setShowEmoji(false)
        emojiButton.current?.focus()
      }
    }}>
      <textarea ref={composer} aria-label="聊天消息" rows={2} maxLength={messageLimit}
        value={draft} disabled={!room.profile} readOnly={sending} onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing
            && window.matchMedia('(pointer: fine)').matches) {
            event.preventDefault()
            event.currentTarget.form?.requestSubmit()
          }
        }} />
      <div className="chat-composer-actions">
        <button type="button" className="chat-icon-button chat-emoji" ref={emojiButton} title="插入表情"
          aria-label="插入表情" aria-expanded={showEmoji} aria-controls="chat-emoji-panel"
          disabled={!room.profile || sending} onClick={() => setShowEmoji((open) => !open)}>
          <svg aria-hidden="true" width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round"><circle cx="12" cy="12" r="8.8" /><path d="M8.3 14.2a4 4 0 0 0 7.4 0M9 9.1h.1m5.8 0h.1" /></svg>
        </button>
        {showEmoji && <div className="chat-emoji-panel" id="chat-emoji-panel" aria-label="常用表情">
          {emojis.map((emoji) => <button key={emoji} type="button" onClick={() => insertEmoji(emoji)}>{emoji}</button>)}
        </div>}
        {sendError && <p className="chat-error chat-send-error" role="alert">{sendError}</p>}
        {draft.length >= messageLimit - 50 && <span className="chat-length">{draft.length}/{messageLimit}</span>}
        <button className="btn btn-sm primary chat-send" type="submit" disabled={!room.profile || !draft.trim() || sending}>
          {sending ? '发送中…' : '发送'}
        </button>
      </div>
    </form>
  </section>
}
