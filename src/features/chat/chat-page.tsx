'use client'

import Image from 'next/image'
import { type FormEvent, type MouseEventHandler, type PointerEvent, type ReactNode, type RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { BackArrowIcon, EditPencilIcon, EmojiIcon, MentionIcon } from '@/components/icons'
import { Badge, Button, TextInput } from '@/components/ui'
import { messages } from '@/config/messages'
import { siteConfig } from '@/config/site'
import { useTabDraft } from '@/use-tab-draft'
import { authorMention, messageLimit, nicknameLimit, publicAuthorMention, type ChatMessage, type ChatProfile } from './types'
import { chatError, useChatRoom } from './use-chat-room'

const emojis = siteConfig.chatEmojis
const time = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
const date = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric' })

export function messageTime(value: string) {
  const sent = new Date(value)
  return `${sent.toDateString() === new Date().toDateString() ? messages.chat.today : date.format(sent)} ${time.format(sent)}`
}

export function Avatar({ profile, size, authorAvatar }: { profile: ChatProfile; size: number; authorAvatar?: string }) {
  const fallback = siteConfig.api.chatAvatarFallback(profile.avatar)
  const src = profile.avatarUrl ?? (profile.author && authorAvatar ? `data:image/webp;base64,${authorAvatar.replace(/\s/g, '')}`
    : profile.avatarImageId ? siteConfig.api.chatAvatar(profile.avatarImageId) : fallback)
  return (
    <Image
      className="rounded-full object-cover shrink-0 bg-surface"
      src={src}
      alt=""
      width={size}
      height={size}
      unoptimized
      onError={(event) => {
        if (event.currentTarget.getAttribute('src') !== fallback) event.currentTarget.src = fallback
      }}
    />
  )
}

function MentionAvatar({ message, nickname, authorAvatar, onMention }: {
  message: ChatMessage
  nickname: string
  authorAvatar?: string
  onMention: () => void
}) {
  const press = useRef<{ timer: ReturnType<typeof setTimeout>; x: number; y: number } | null>(null)
  const held = useRef(false)
  function clear() {
    if (press.current) clearTimeout(press.current.timer)
    press.current = null
  }
  useEffect(() => clear, [])

  function start(event: PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return
    clear()
    held.current = false
    press.current = { x: event.clientX, y: event.clientY, timer: setTimeout(() => {
      held.current = true
      onMention()
    }, siteConfig.timings.mentionHoldMs) }
  }

  return (
    <button
      className="tactile p-0 bg-transparent shrink-0 rounded-full"
      type="button"
      aria-label={messages.chat.mentionAria(nickname)}
      title={messages.chat.mentionTitle(nickname)}
      onPointerDown={start}
      onPointerUp={clear}
      onPointerCancel={clear}
      onPointerLeave={clear}
      onPointerMove={(event) => {
        const origin = press.current
        if (origin && Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > 9) clear()
      }}
      onContextMenu={(event) => event.preventDefault()}
      onClick={(event) => {
        if (!held.current && (event.detail === 0 || window.matchMedia('(pointer: fine)').matches)) onMention()
        held.current = false
      }}
    >
      <Avatar profile={message} size={36} authorAvatar={authorAvatar} />
    </button>
  )
}

type OutgoingMessage = { id: string; body: string; sentAt: string; error?: string }

function Message({ message, nickname, previous, authorAvatar, onMention, delivery }: {
  message: ChatMessage
  nickname: string
  previous?: ChatMessage
  authorAvatar?: string
  onMention: () => void
  delivery?: ReactNode
}) {
  const gap = previous ? Date.parse(message.sentAt) - Date.parse(previous.sentAt) : Infinity
  const bubbleCls = message.mine
    ? 'bg-cta text-cta-ink'
    : message.aiReplyTo
      ? 'bg-selected-fill text-ink-primary'
      : 'bg-surface text-ink-primary'

  return (
    <li className="flex flex-col gap-2 animate-msg-in" data-message-id={message.id}>
      {gap >= 5 * 60 * 1000 && (
        <time className="text-center text-micro text-ink-muted my-1" dateTime={message.sentAt}>
          {messageTime(message.sentAt)}
        </time>
      )}
      <div className={`flex items-start gap-2.5 ${message.mine ? 'flex-row-reverse' : ''}`}>
        {message.mine ? (
          <Avatar profile={message} size={36} authorAvatar={authorAvatar} />
        ) : (
          <MentionAvatar message={message} nickname={nickname} authorAvatar={authorAvatar} onMention={onMention} />
        )}
        <div className={`flex flex-col gap-1 max-w-bubble ${message.mine ? 'items-end' : 'items-start'}`}>
          <span className="text-xs font-medium text-ink-secondary px-1">{nickname}</span>
          <p className={`m-0 px-3.75 py-2.75 rounded-option text-body break-words whitespace-pre-wrap ${bubbleCls}`} dir="auto">
            {message.aiReplyTo && (
              <Badge tone="selected" size="xs" className="mr-1.5 bg-selected-badge text-white align-middle">
                {messages.chat.aiAutoTag}
              </Badge>
            )}
            {message.body}
          </p>
          {delivery}
        </div>
      </div>
    </li>
  )
}

export function ChatHeader({ title, backHref, backLabel, onBack, heading, children }: {
  title: string
  backHref: string
  backLabel: string
  onBack?: MouseEventHandler<HTMLAnchorElement>
  heading: RefObject<HTMLHeadingElement | null>
  children?: ReactNode
}) {
  return (
    <header className="flex items-center justify-between gap-3 flex-wrap pb-2">
      <div className="flex items-center gap-2.5">
        <a
          className="icon-btn no-underline"
          href={backHref}
          onClick={onBack}
          aria-label={backLabel}
          title={backLabel}
        >
          <BackArrowIcon />
        </a>
        <h1 id="chat-title" ref={heading} tabIndex={-1} className="font-serif m-0 text-sub-title font-bold outline-none">
          {title}
        </h1>
      </div>
      {children}
    </header>
  )
}

type ChatDraft = { text: string; clientId?: string }
const messageKey = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i

function readChatDraft(value: unknown): ChatDraft | null {
  const draft = value as Partial<ChatDraft> | null
  if (typeof draft?.text !== 'string') return null
  const clientId = typeof draft.clientId === 'string' && messageKey.test(draft.clientId)
    ? draft.clientId : undefined
  return { text: draft.text.slice(0, messageLimit), clientId }
}

function readOutbox(value: unknown) {
  if (!Array.isArray(value)) return null
  return value.filter((entry): entry is OutgoingMessage => typeof entry?.id === 'string' && messageKey.test(entry.id)
    && typeof entry.body === 'string' && entry.body.length > 0 && entry.body.length <= messageLimit
    && typeof entry.sentAt === 'string' && Number.isFinite(Date.parse(entry.sentAt))
    && (entry.error === undefined || typeof entry.error === 'string'))
}

export function PublicChat({ userId, backHref, onBack, onRead }: {
  userId: string
  backHref: string
  onBack: MouseEventHandler<HTMLAnchorElement>
  onRead: (unread: boolean) => void
}) {
  const room = useChatRoom(userId)
  return <ChatPage room={room} draftKey={siteConfig.storageKeys.chatDraft(userId, 'public')} backHref={backHref} onBack={onBack} onRead={onRead} />
}

export default function ChatPage({ backHref, backLabel = messages.common.backToPractice, direct = false, room, draftKey, onBack, onRead }: {
  backHref: string
  backLabel?: string
  direct?: boolean
  room: ReturnType<typeof useChatRoom>
  draftKey: string
  onBack?: MouseEventHandler<HTMLAnchorElement>
  onRead?: (unread: boolean) => void
}) {
  const section = useRef<HTMLElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const composer = useRef<HTMLTextAreaElement>(null)
  const emojiButton = useRef<HTMLButtonElement>(null)
  const emojiPanel = useRef<HTMLDivElement>(null)
  const nicknameInput = useRef<HTMLInputElement>(null)
  const nicknameButton = useRef<HTMLButtonElement>(null)
  const nearBottom = useRef(true)
  const prepend = useRef<{ element: HTMLElement; offset: number } | null>(null)
  const newestSeen = useRef<string | undefined>(undefined)
  const readThrough = useRef<string | undefined>(undefined)
  const sendingNow = useRef(false)
  const [newMessages, setNewMessages] = useState(false)
  const [editingName, setEditingName] = useState(false)
  const [nickname, setNickname] = useState('')
  const [savingName, setSavingName] = useState(false)
  const [nameError, setNameError] = useState('')
  const { value: storedDraft, save } = useTabDraft(draftKey, readChatDraft)
  const draft = storedDraft?.text ?? ''
  const { value: outgoing, snapshot: outboxSnapshot, update: updateOutbox } = useTabDraft(`${draftKey}:outbox`, readOutbox)
  const [sendingId, setSendingId] = useState<string>()
  const sending = sendingId !== undefined
  const [showEmoji, setShowEmoji] = useState(false)

  useEffect(() => {
    heading.current?.focus({ preventScroll: true })
    section.current?.scrollIntoView({ block: 'start' })
  }, [])
  useEffect(() => { if (editingName) nicknameInput.current?.focus() }, [editingName])
  useEffect(() => {
    if (!showEmoji) return
    function closeOutside(event: globalThis.PointerEvent) {
      const target = event.target
      if (!(target instanceof Node) || emojiButton.current?.contains(target) || emojiPanel.current?.contains(target)) return
      setShowEmoji(false)
    }
    document.addEventListener('pointerdown', closeOutside, true)
    return () => document.removeEventListener('pointerdown', closeOutside, true)
  }, [showEmoji])

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
      setNewMessages(true)
    }
    newestSeen.current = last
  }, [room.messages, outboxSnapshot])

  const newestIncoming = room.messages.findLast((message) => !message.mine)?.id
  const { markRead } = room
  useEffect(() => {
    if (!newestIncoming || !markRead || newMessages) return
    let active = true
    let inFlight = false
    let retry: ReturnType<typeof setTimeout>
    async function confirmRead() {
      if (!active || inFlight || !nearBottom.current || document.hidden || !navigator.onLine || readThrough.current === newestIncoming) return
      inFlight = true
      try {
        const result = await markRead!(newestIncoming!)
        if (active) {
          readThrough.current = newestIncoming
          onRead?.(result.unread)
        }
      } catch {
        if (active) retry = setTimeout(confirmRead, siteConfig.timings.chatReadRetryMs)
      } finally {
        inFlight = false
      }
    }
    void confirmRead()
    document.addEventListener('visibilitychange', confirmRead)
    window.addEventListener('online', confirmRead)
    return () => {
      active = false
      clearTimeout(retry)
      document.removeEventListener('visibilitychange', confirmRead)
      window.removeEventListener('online', confirmRead)
    }
  }, [markRead, newestIncoming, newMessages, onRead])

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
      setNameError(chatError(error, messages.chat.saveNicknameError))
    } finally {
      setSavingName(false)
    }
  }

  function setDraft(text: string) {
    save(text ? { text, clientId: text.trim() === draft.trim() ? storedDraft?.clientId : undefined } : null)
  }

  async function deliver(message: OutgoingMessage) {
    if (sendingNow.current) return
    sendingNow.current = true
    setSendingId(message.id)
    updateOutbox((previous) => [
      ...(previous ?? []).filter(({ id }) => id !== message.id), { ...message, error: undefined },
    ])
    scrollToLatest()
    try {
      await room.send(message.body, message.id)
      updateOutbox((previous) => previous?.filter(({ id }) => id !== message.id) ?? null)
    } catch (error) {
      updateOutbox((previous) => previous?.map((item) => item.id === message.id
        ? { ...item, error: chatError(error, messages.chat.sendFallbackError) } : item) ?? null)
    } finally {
      sendingNow.current = false
      setSendingId(undefined)
    }
  }

  function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const body = draft.trim()
    if (!room.profile || !body || sendingNow.current) return
    setShowEmoji(false)
    void deliver({ body, id: storedDraft?.clientId ?? crypto.randomUUID(), sentAt: new Date().toISOString() })
    save(null)
  }

  function insertText(text: string, mention = false) {
    const input = composer.current
    if (!input) return
    const { selectionStart, selectionEnd } = input
    const before = draft.slice(0, selectionStart)
    const insertion = mention && before && !/\s$/.test(before) ? ` ${text}` : text
    const next = before + insertion + draft.slice(selectionEnd)
    if (next.length > messageLimit) return
    setDraft(next)
    setShowEmoji(false)
    requestAnimationFrame(() => {
      input.focus()
      input.setSelectionRange(selectionStart + insertion.length, selectionStart + insertion.length)
    })
  }

  function mention(profile?: ChatProfile) {
    if (!room.profile) return
    const ownerMention = direct ? authorMention : publicAuthorMention
    const name = !profile || profile.author ? ownerMention : `@${room.displayNickname(profile)}`
    insertText(name + ' ', true)
  }

  const profile = room.profile
  const unconfirmed = outgoing?.filter((item) => !room.messages.some((message) => message.clientId === item.id)) ?? []

  return (
    <section className="chat-shell animate-view-enter" ref={section} aria-labelledby="chat-title">
      <ChatHeader title={direct ? messages.chat.authorTitle : messages.chat.publicTitle} backHref={backHref} backLabel={backLabel} onBack={onBack} heading={heading}>
        {direct && room.peer && (
          <div className="flex items-center gap-2.5 bg-surface px-3 py-1.5 rounded-control">
            <Avatar profile={room.peer} size={28} authorAvatar={room.authorAvatar} />
            <div className="flex flex-col leading-tight">
              <span className="text-meta font-medium" title={room.peer.nickname}>{room.peer.nickname}</span>
              {room.peer.email && <small className="text-micro text-ink-muted" title={room.peer.email}>{room.peer.email}</small>}
            </div>
          </div>
        )}
        {!direct && room.profile?.author && (
          <div className="flex items-center gap-2 bg-surface px-3 py-1.5 rounded-control text-meta font-medium" title={room.profile.nickname}>
            <Avatar profile={room.profile} size={28} authorAvatar={room.authorAvatar} />
            <span>{room.profile.nickname}</span>
          </div>
        )}
        {!direct && room.profile && !room.profile.author && (
          <button
            type="button"
            className="btn-surface h-9.5 px-3 rounded-compact inline-flex items-center gap-2 text-meta font-medium"
            ref={nicknameButton}
            aria-label={messages.chat.editNicknameAria}
            aria-controls="chat-edit-name"
            aria-expanded={editingName}
            onClick={() => {
              if (editingName) {
                if (!savingName) closeNickname()
                return
              }
              setNickname(room.profile!.nickname)
              setNameError('')
              setEditingName(true)
            }}
          >
            <Avatar profile={room.profile} size={26} authorAvatar={room.authorAvatar} />
            <span className="max-w-nickname truncate">{room.profile.nickname}</span>
            <EditPencilIcon />
          </button>
        )}
      </ChatHeader>

      {editingName && (
        <form
          id="chat-edit-name"
          className="p-3.5 rounded-option bg-surface flex items-center gap-2 flex-wrap"
          onSubmit={saveNickname}
          onKeyDown={(event) => { if (event.key === 'Escape' && !savingName && !event.nativeEvent.isComposing) closeNickname() }}
        >
          <label htmlFor="chat-nickname" className="text-xs font-medium text-ink-secondary">{messages.chat.nicknameLabel}</label>
          <TextInput
            id="chat-nickname"
            ref={nicknameInput}
            className="h-9.5 flex-1 min-w-40 bg-canvas"
            value={nickname}
            onChange={(event) => setNickname(event.target.value)}
            maxLength={nicknameLimit}
            readOnly={savingName}
            required
          />
          <Button variant="surface" size="sm" className="h-9.5 px-3 bg-canvas text-xs" disabled={savingName} onClick={closeNickname}>
            {messages.common.cancel}
          </Button>
          <Button variant="cta" size="sm" type="submit" className="h-9.5 px-3.5 text-xs" disabled={savingName || !nickname.trim()}>
            {messages.common.save}
          </Button>
          {nameError && <p className="m-0 w-full text-xs text-wrong-ink" role="alert">{nameError}</p>}
        </form>
      )}

      {room.readError && (
        <div className="px-4 py-2.5 rounded-control bg-wrong-fill text-wrong-ink text-xs flex items-center justify-between" role="status">
          <span>{room.readError}</span>
          <Button variant="surface" size="xs" className="bg-canvas text-ink-primary" onClick={room.retry}>{messages.common.retry}</Button>
        </div>
      )}

      <div className="relative flex-1 min-h-0 flex flex-col">
        <div
          className="chat-log-viewport"
          ref={list}
          role="region"
          aria-label={messages.chat.messagesAria}
          tabIndex={0}
          onScroll={() => {
            const log = list.current
            if (!log) return
            nearBottom.current = log.scrollHeight - log.clientHeight - log.scrollTop < 64
            if (nearBottom.current) setNewMessages(false)
          }}
        >
          {room.hasOlder && (
            <div className="text-center py-1">
              <Button
                variant="surface"
                size="xs"
                className="h-8.5 px-3.5 rounded-micro"
                onClick={() => void room.loadOlder(rememberHistoryPosition)}
                disabled={room.loadingOlder}
              >
                {room.loadingOlder ? messages.common.loading : messages.chat.loadOlder}
              </Button>
              {room.historyError && <p className="m-0 mt-1 text-xs text-wrong-ink" role="alert">{room.historyError}</p>}
            </div>
          )}

          {room.messages.length > 0 || unconfirmed.length > 0 ? (
            <ol className="m-0 p-0 list-none flex flex-col gap-3">
              {room.messages.map((message, index) => (
                <Message
                  key={message.clientId ?? message.id}
                  message={message}
                  nickname={room.displayNickname(message)}
                  previous={room.messages[index - 1]}
                  authorAvatar={room.authorAvatar}
                  onMention={() => mention(message)}
                />
              ))}
              {profile && unconfirmed.map((item) => (
                <Message
                  key={item.id}
                  message={{ ...profile, ...item, mine: true }}
                  nickname={profile.nickname}
                  previous={room.messages.at(-1)}
                  authorAvatar={room.authorAvatar}
                  onMention={() => {}}
                  delivery={sendingId !== item.id ? (
                    <div className="flex items-center gap-2 text-xs text-wrong-ink mt-1" role="alert">
                      <span>{item.error ?? messages.chat.sendFallbackError}</span>
                      <button type="button" className="tactile underline" disabled={sending} onClick={() => void deliver(item)}>{messages.chat.resend}</button>
                      <button type="button" className="tactile underline" onClick={() => updateOutbox((before) => before?.filter(({ id }) => id !== item.id) ?? null)}>{messages.chat.remove}</button>
                    </div>
                  ) : (
                    <p className="m-0 text-xs text-ink-muted" role="status">{messages.chat.sendingStatus}</p>
                  )}
                />
              ))}
            </ol>
          ) : (
            !room.profile && !room.readError && (
              <p className="py-12 text-center text-sm text-ink-muted" role="status">{messages.chat.loadingMessages}</p>
            )
          )}
        </div>

        {newMessages && (
          <Button
            variant="cta"
            size="xs"
            className="animate-badge-pop absolute bottom-3 left-1/2 -translate-x-1/2 h-8.5 px-3.5 rounded-full shadow-desktop"
            onClick={scrollToLatest}
          >
            {messages.chat.jumpToLatest}
          </Button>
        )}
      </div>

      <form
        className="chat-composer-form"
        onSubmit={sendMessage}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && showEmoji) {
            setShowEmoji(false)
            emojiButton.current?.focus()
          }
        }}
      >
        <textarea
          ref={composer}
          className="chat-composer-input"
          aria-label={messages.chat.composerAria}
          placeholder={direct ? messages.chat.composerDirectPlaceholder : messages.chat.composerPublicPlaceholder}
          rows={2}
          maxLength={messageLimit}
          value={draft}
          disabled={!room.profile}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing
              && window.matchMedia('(pointer: fine)').matches) {
              event.preventDefault()
              event.currentTarget.form?.requestSubmit()
            }
          }}
        />
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              className="tactile w-9 h-9 rounded-micro bg-canvas text-ink-secondary hover:bg-surface-hover flex items-center justify-center"
              ref={emojiButton}
              title={messages.chat.insertEmoji}
              aria-label={messages.chat.insertEmoji}
              aria-expanded={showEmoji}
              aria-controls="chat-emoji-panel"
              disabled={!room.profile}
              onClick={() => setShowEmoji((open) => !open)}
            >
              <EmojiIcon />
            </button>
            <button
              className="tactile w-9 h-9 rounded-micro bg-canvas text-ink-secondary hover:bg-surface-hover flex items-center justify-center"
              type="button"
              aria-label={direct && room.peer && !room.peer.author ? messages.chat.mentionPeer : messages.chat.mentionAuthor}
              disabled={!room.profile}
              onClick={() => mention(room.peer)}
            >
              <MentionIcon />
            </button>
            {draft.length >= messageLimit - 50 && (
              <span className="text-xs text-ink-muted tabular-nums ml-1">{draft.length}/{messageLimit}</span>
            )}
          </div>

          <Button variant="cta" size="md" className="px-4.5 rounded-micro text-control" type="submit" disabled={!room.profile || !draft.trim() || sending}>
            {messages.chat.send}
          </Button>
        </div>

        {showEmoji && (
          <div className="emoji-popover" ref={emojiPanel} id="chat-emoji-panel" aria-label={messages.chat.emojiPanelAria}>
            {emojis.map((emoji) => (
              <button key={emoji} type="button" className="tactile w-9 h-9 rounded-tag hover:bg-surface hover:scale-115 text-lg flex items-center justify-center" onClick={() => insertText(emoji)}>
                {emoji}
              </button>
            ))}
          </div>
        )}
      </form>
    </section>
  )
}
