'use client'

import Image from 'next/image'
import dynamic from 'next/dynamic'
import Link, { useLinkStatus } from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createContext, Fragment, type MouseEvent, type ReactNode, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { siteConfig } from '@/config/site'
import { messages } from '@/config/messages'
import { ChatBubbleIcon, ChevronDownIcon, MailboxIcon, MoonIcon, OverviewIcon, SponsorIcon, SunIcon, UserIcon } from '@/components/icons'
import { ActionLink, BottomDrawer, Button, StatTile, UnreadDot } from '@/components/ui'
import { warmSharedChat } from '../chat/shared-chat-cache'
import { authorChatHash, unreadDescriptionId } from '../chat/types'
import { useChatUnread } from '../chat/use-chat-unread'
import { questionUrl, readPublic, requestJson, StudyRequestError, type QuestionState, type StudyStats, type Topic, writeJson } from './api'
import { FeedbackPage } from './feedback-page'
import { practiceUndonePreference } from './practice-undone'
import { libraryPath, readLibraryView, type StudyPreferences, useAccountStudyPreferences, useAccountStudyScroll } from './preferences'
import { useAttemptQueue } from './use-attempt-queue'
import { createPersonalStudyReads, useStudyData } from './use-study-data'

const loadChatPage = () => import('../chat/chat-page')
const PublicChat = dynamic(() => loadChatPage().then(({ PublicChat }) => PublicChat), {
  loading: () => <p className="py-12 text-center text-sm text-ink-secondary" role="status">{messages.shell.openingChat}</p>,
})
const loadAuthorChat = () => import('../chat/author-chat-page')
const AuthorChatPage = dynamic(loadAuthorChat, {
  loading: () => <p className="py-12 text-center text-sm text-ink-secondary" role="status">{messages.shell.openingAuthorChat}</p>,
})

function warmImage(src: string) {
  if (!navigator.onLine) return
  const image = new window.Image()
  image.src = src
}

function warmChat(userId: string) {
  if (!navigator.onLine) return
  warmImage(siteConfig.assets.aiAvatar)
  void loadChatPage().catch(() => {})
  void warmSharedChat(userId).catch(() => {})
}

type QuestionStates = { states: Record<string, QuestionState> }
type QuestionStateRead = { revision: number; expiresAt: number; response: Promise<QuestionStates> }
type FavoriteWrite = { desired: boolean }

function statesPath(ids: string[]) {
  return `/api/me/question-state?${new URLSearchParams({ ids: ids.join(',') })}`
}

function StudyNavigationStatus() {
  const { pending } = useLinkStatus()
  return (
    <span className="sr-only" role="status">
      {pending && <span className="study-navigation-pending">{messages.shell.pageSwitching}</span>}
    </span>
  )
}

function subscribeHash(change: () => void) {
  window.addEventListener('hashchange', change)
  return () => window.removeEventListener('hashchange', change)
}

function currentHash() {
  return window.location.hash
}

function emptyHash() {
  return ''
}

function footerPath(url: URL | Location) {
  return url.pathname + url.search + url.hash
}

function footerHistory(): string[] {
  const back = history.state?.studyFooterBack
  return typeof back === 'string' ? [back] : back ?? []
}

function returnToFooterPath(url: URL) {
  const entries = footerHistory()
  const index = entries.lastIndexOf(footerPath(url))
  if (index >= 0) {
    history.go(index - entries.length)
    return
  }
  history.replaceState(history.state, '', url)
  window.dispatchEvent(new HashChangeEvent('hashchange'))
}

function closeFooterPage(event: { preventDefault: () => void }) {
  event.preventDefault()
  const url = new URL(location.href)
  url.hash = ''
  returnToFooterPath(url)
}

function isFooterLinkClick(event: MouseEvent<HTMLAnchorElement>) {
  return !event.defaultPrevented && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey
}

function backFromAuthorChat(event: MouseEvent<HTMLAnchorElement>) {
  if (!isFooterLinkClick(event)) return
  event.preventDefault()
  returnToFooterPath(new URL(event.currentTarget.href))
}

function useTheme(theme: unknown, save: (edits: Record<string, unknown>) => void) {
  const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>('light')

  useEffect(() => {
    const preference = window.matchMedia('(prefers-color-scheme: dark)')
    function applyPreference() {
      const next = theme === 'dark' || (theme !== 'light' && preference.matches) ? 'dark' : 'light'
      document.documentElement.dataset.theme = next
      setResolvedTheme(next)
    }
    applyPreference()
    preference.addEventListener('change', applyPreference)
    return () => {
      preference.removeEventListener('change', applyPreference)
      delete document.documentElement.dataset.theme
    }
  }, [theme])

  function toggleTheme() {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'
    document.documentElement.dataset.theme = next
    setResolvedTheme(next)
    save({ theme: next })
  }

  return { resolvedTheme, toggleTheme }
}

function useStudySession(userId: string, initialPreferences: Promise<StudyPreferences | null>, initialStats: Promise<StudyStats | null>) {
  const [revision, setRevision] = useState(0)
  const [personalReads] = useState(() => createPersonalStudyReads(userId))
  const stateRevision = useRef(0)
  const stateReads = useRef(new Map<string, QuestionStateRead>())
  const [knownStates, setKnownStates] = useState<Record<string, Partial<QuestionState>>>({})
  const favoriteWrites = useRef(new Map<string, FavoriteWrite>())
  const [pendingFavorites, setPendingFavorites] = useState<Record<string, boolean>>({})
  const [favoriteErrors, setFavoriteErrors] = useState<Record<string, string>>({})
  const examActive = useRef(false)
  const markExamActive = useCallback((active: boolean) => { examActive.current = active }, [])
  const refreshMe = useCallback(() => {
    personalReads.invalidate()
    stateRevision.current += 1
    setRevision(stateRevision.current)
  }, [personalReads])
  const stats = useStudyData<StudyStats>(siteConfig.api.stats, revision, { ...personalReads, initial: initialStats, keepPreviousData: true })
  const [bootstrapPreferences, setBootstrapPreferences] = useState<StudyPreferences>()
  useEffect(() => {
    let active = true
    void Promise.resolve(initialPreferences).then((value) => {
      if (active && value) setBootstrapPreferences(value)
    }, () => {})
    return () => { active = false }
  }, [initialPreferences])
  const preferences = useAccountStudyPreferences(userId, stats.data?.preferences ?? bootstrapPreferences, stats.loading)
  const topics = useStudyData<{ topics: Topic[] }>(siteConfig.api.topics)
  const attempts = useAttemptQueue(userId, refreshMe)

  const readQuestionStates = useCallback((path: string) => {
    const reads = stateReads.current
    const epoch = stateRevision.current
    const cached = reads.get(path)
    if (cached?.revision === epoch && cached.expiresAt > Date.now()) return cached.response
    const entry: QuestionStateRead = {
      revision: epoch,
      expiresAt: Infinity,
      response: requestJson<QuestionStates>(path, { headers: { 'X-Study-Account': userId } }).then((data) => {
        entry.expiresAt = Date.now() + 15_000
        if (stateRevision.current === epoch) setKnownStates((previous) => ({ ...previous, ...data.states }))
        return data
      }).catch((error: unknown) => {
        if (reads.get(path) === entry) reads.delete(path)
        throw error
      }),
    }
    reads.delete(path)
    reads.set(path, entry)
    if (reads.size > 32) reads.delete(reads.keys().next().value!)
    return entry.response
  }, [userId])

  const prefetchQuestionStates = useCallback((ids: string[]) => readQuestionStates(statesPath(ids)), [readQuestionStates])

  async function saveFavorite(id: string, write: FavoriteWrite) {
    let saved: boolean | undefined
    try {
      do {
        const favorite = write.desired
        await writeJson(`/api/me/favorites/${id}`, userId, 'PUT', { favorite })
        saved = favorite
      } while (saved !== write.desired)
    } catch (error) {
      const message = error instanceof StudyRequestError ? error.message : messages.shell.favoriteSaveError
      setFavoriteErrors((previous) => ({ ...previous, [id]: message }))
    } finally {
      favoriteWrites.current.delete(id)
      if (saved !== undefined) {
        setKnownStates((previous) => ({ ...previous, [id]: { ...previous[id], isFavorite: saved } }))
      }
      setPendingFavorites((previous) => {
        const next = { ...previous }
        delete next[id]
        return next
      })
      refreshMe()
    }
  }

  function toggleFavorite(id: string, favorite: boolean) {
    if (!navigator.onLine) {
      setFavoriteErrors((previous) => ({ ...previous, [id]: messages.shell.favoriteOfflineError }))
      return
    }
    setFavoriteErrors((previous) => {
      if (!previous[id]) return previous
      const next = { ...previous }
      delete next[id]
      return next
    })
    const queued = favoriteWrites.current.get(id)
    const desired = !(queued?.desired ?? favorite)
    setPendingFavorites((previous) => ({ ...previous, [id]: desired }))
    if (queued) {
      queued.desired = desired
      return
    }
    const write = { desired }
    favoriteWrites.current.set(id, write)
    void saveFavorite(id, write)
  }

  async function removeWrong(id: string) {
    await writeJson(`/api/me/wrong/${id}`, userId, 'DELETE')
    refreshMe()
  }

  function confirmLeaveExam() {
    return !examActive.current || window.confirm(messages.shell.leaveExamConfirm)
  }

  return {
    userId, revision, stats, topics, attempts, preferences, knownStates, readQuestionStates, prefetchQuestionStates, personalReads,
    pendingFavorites, favoriteErrors, toggleFavorite, removeWrong, refreshMe, markExamActive, confirmLeaveExam,
  }
}

const StudyContext = createContext<ReturnType<typeof useStudySession> | null>(null)

export function useStudySessionContext() {
  const context = useContext(StudyContext)
  if (!context) throw new Error('Study layout is required')
  return context
}

export function useQuestionStates(ids: string[]) {
  const { revision, knownStates, readQuestionStates } = useStudySessionContext()
  const result = useStudyData<QuestionStates>(ids.length ? statesPath(ids) : null, revision, { load: readQuestionStates })
  return {
    ...result,
    data: ids.some((id) => knownStates[id] !== undefined) ? { states: knownStates } : result.data,
  }
}

export function useQuestionFavorite(id: string, serverFavorite?: boolean) {
  const { knownStates, pendingFavorites, favoriteErrors, toggleFavorite } = useStudySessionContext()
  const favorite = pendingFavorites[id] ?? knownStates[id]?.isFavorite ?? serverFavorite ?? false
  return {
    favorite,
    pending: pendingFavorites[id] !== undefined,
    error: favoriteErrors[id],
    toggle: () => toggleFavorite(id, favorite),
  }
}

export function StudyShell({ userId, author, initialPreferences, initialStats, brandSlot, sponsorSlot, children }: {
  userId: string; author: boolean; initialPreferences: Promise<StudyPreferences | null>
  initialStats: Promise<StudyStats | null>
  brandSlot: ReactNode; sponsorSlot: ReactNode; children: ReactNode
}) {
  const pathname = usePathname()
  const router = useRouter()
  const hash = useSyncExternalStore(subscribeHash, currentHash, emptyHash)
  const [initialFooterPath] = useState(() => {
    if (typeof window === 'undefined') return null
    const current = window.location.hash
    const matched = current === siteConfig.hashes.chat
      || current === siteConfig.hashes.feedback
      || current === siteConfig.hashes.sponsor
      || current === siteConfig.hashes.authorChat
      || current.startsWith(`${siteConfig.hashes.authorChat}/`)
    return matched ? window.location.pathname : null
  })
  const sponsorOpen = hash === siteConfig.hashes.sponsor
  const feedbackOpen = hash === siteConfig.hashes.feedback
  const chatOpen = hash === siteConfig.hashes.chat
  const authorChatOpen = hash === authorChatHash || hash.startsWith(authorChatHash + '/')
  const [authorChatRequested, setAuthorChatRequested] = useState(false)
  const threadId = hash.startsWith(authorChatHash + '/') ? hash.slice(authorChatHash.length + 1) : undefined
  const footerPageOpen = sponsorOpen || feedbackOpen || chatOpen || authorChatOpen
  const chatPageOpen = chatOpen || authorChatOpen
  const viewportPageOpen = chatPageOpen || feedbackOpen
  const viewportShell = useRef<HTMLDivElement>(null)
  const { unread, sharedUnread, updateUnread, updateSharedUnread } = useChatUnread(userId, feedbackOpen || authorChatOpen)
  const session = useStudySession(userId, initialPreferences, initialStats)
  const { personalReads, preferences } = session
  const { resolvedTheme, toggleTheme } = useTheme(preferences.values.theme, preferences.save)
  const [overviewOpen, setOverviewOpen] = useState(false)
  const [mobileSettingsOpen, setMobileSettingsOpen] = useState(false)
  useAccountStudyScroll(footerPageOpen ? '' : pathname, preferences)
  const publicLibrary = libraryPath('all', readLibraryView(preferences.values['library:all']))
  const wrongLibrary = libraryPath('wrong', readLibraryView(preferences.values['library:wrong']))
  const favoriteLibrary = libraryPath('favorite', readLibraryView(preferences.values['library:favorite']))
  const firstTopic = session.topics.data?.topics.find(({ count }) => count > 0)?.id
  const warmedLibrary = useRef<string | undefined>(undefined)
  const navRef = useRef<HTMLElement>(null)
  const navLinkRefs = useRef<Record<string, HTMLAnchorElement | null>>({})
  const [navIndicator, setNavIndicator] = useState({ left: 0, width: 0, visible: false })

  useLayoutEffect(() => {
    const shell = viewportShell.current
    const viewport = window.visualViewport
    if (!viewportPageOpen || !shell || !viewport) return
    const fitViewport = () => {
      shell.style.setProperty('--panel-height', `${viewport.height}px`)
      shell.style.setProperty('--panel-top', `${viewport.offsetTop}px`)
    }
    fitViewport()
    viewport.addEventListener('resize', fitViewport)
    viewport.addEventListener('scroll', fitViewport)
    return () => {
      viewport.removeEventListener('resize', fitViewport)
      viewport.removeEventListener('scroll', fitViewport)
      shell.style.removeProperty('--panel-height')
      shell.style.removeProperty('--panel-top')
    }
  }, [viewportPageOpen])

  useLayoutEffect(() => {
    const activeHref = !footerPageOpen ? siteConfig.nav.find(({ href }) => href === pathname)?.href : undefined
    const updateIndicator = () => {
      const target = activeHref ? navLinkRefs.current[activeHref] : null
      if (!target) {
        setNavIndicator((prev) => (prev.visible ? { ...prev, visible: false } : prev))
        return
      }
      const { offsetLeft: left, offsetWidth: width } = target
      setNavIndicator((prev) => prev.visible && prev.left === left && prev.width === width
        ? prev : { left, width, visible: true })
    }
    updateIndicator()
    const navEl = navRef.current
    if (!navEl || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(updateIndicator)
    observer.observe(navEl)
    return () => observer.disconnect()
  }, [footerPageOpen, pathname])

  useEffect(() => {
    if (chatOpen) warmChat(userId)
  }, [chatOpen, userId])
  useEffect(() => {
    if (pathname === siteConfig.routes.practice && !preferences.ready && firstTopic && navigator.onLine) {
      void readPublic(questionUrl({ topic: firstTopic, offset: 0, limit: 15, practice: true })).catch(() => {})
    }
  }, [firstTopic, pathname, preferences.ready])
  useEffect(() => {
    if (pathname !== siteConfig.routes.practice || footerPageOpen || !firstTopic || !preferences.ready
      || !publicLibrary.startsWith(siteConfig.api.publicPrefix) || warmedLibrary.current === publicLibrary) return
    const timer = setTimeout(() => {
      if (!navigator.onLine || document.hidden) return
      warmedLibrary.current = publicLibrary
      void readPublic(publicLibrary).catch(() => { warmedLibrary.current = undefined })
    }, siteConfig.timings.libraryPrefetchMs * 2)
    return () => clearTimeout(timer)
  }, [firstTopic, footerPageOpen, pathname, preferences.ready, publicLibrary])

  function warmRoute(href: string) {
    if (pathname === href || !navigator.onLine) return
    if (href === siteConfig.routes.questions) void (publicLibrary.startsWith(siteConfig.api.mePrefix) ? personalReads.load(publicLibrary) : readPublic(publicLibrary)).catch(() => {})
    if (href === siteConfig.routes.wrong || href === siteConfig.routes.favorites) {
      void personalReads.load(href === siteConfig.routes.wrong ? wrongLibrary : favoriteLibrary).catch(() => {})
    }
    router.prefetch(href)
  }

  function navigateFromExam(event: { preventDefault: () => void }) {
    if (pathname !== siteConfig.routes.exam || session.confirmLeaveExam()) return true
    event.preventDefault()
    return false
  }

  function navigateToModule(href: string, event: { preventDefault: () => void }) {
    if (footerPageOpen && href === pathname) {
      closeFooterPage(event)
    } else if ((href === siteConfig.routes.exam || navigateFromExam(event)) && href === initialFooterPath) {
      event.preventDefault()
      if (href !== pathname) window.location.assign(href)
    }
  }

  function openFooterPage(event: MouseEvent<HTMLAnchorElement>, nested = false) {
    if (!isFooterLinkClick(event)) return false
    const destination = new URL(event.currentTarget.href)
    event.preventDefault()
    setOverviewOpen(false)
    setMobileSettingsOpen(false)
    if (destination.hash === hash || (!nested && !navigateFromExam(event))) return false
    if (footerPageOpen && !nested) {
      returnToFooterPath(destination)
      return true
    }
    const back = nested ? [...footerHistory(), footerPath(location)] : [destination.pathname + destination.search]
    history.pushState({ ...history.state, studyFooterBack: back }, '', destination)
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    return true
  }

  const topicEntries = session.topics.data?.topics ?? []
  const practicePref = (preferences.values.practice as { mode?: string; topic?: string } | undefined) ?? {}
  const practiceMode = siteConfig.practiceModes.find((m) => m.id === practicePref.mode)?.id ?? 'topic'
  const practiceModeLabel = siteConfig.practiceModes.find((m) => m.id === practiceMode)?.label ?? messages.shell.practiceModes.topic
  const activeTopic = topicEntries.find((entry) => entry.id === practicePref.topic) ?? topicEntries.find((entry) => entry.count > 0) ?? topicEntries[0]
  const practiceOnlyUndone = preferences.values[practiceUndonePreference] === true
  const mobileSubtitle = `${practiceModeLabel}${messages.shell.practiceSubtitleSuffix}${practiceOnlyUndone ? messages.shell.practiceOnlyUndoneTag : ''}`
  const mobileTitle = practiceMode === 'topic' ? (activeTopic?.name ?? messages.shell.topicPracticeTitle) : messages.shell.drawerSettingsTitle
  const statValues = session.stats.data

  const themeIcon = resolvedTheme === 'dark' ? <SunIcon /> : <MoonIcon />

  return (
    <StudyContext.Provider value={session}>
      <div ref={viewportShell} data-study-panel={viewportPageOpen ? '' : undefined} className="min-h-dvh bg-canvas text-ink-primary flex flex-col">
        <header id="site-header" hidden={chatPageOpen} className="floating-header shrink-0 bg-canvas-header backdrop-blur-md">
          <div className="max-w-topbar mx-auto w-full px-3 py-2 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-2 lg:h-16 lg:flex lg:justify-between lg:gap-5 lg:px-7 lg:py-0">
            {brandSlot}

            <nav id="top-nav" ref={navRef} className="relative pointer-events-auto order-last col-span-2 flex items-center gap-0.5 bg-surface p-1 rounded-control lg:order-none lg:gap-1.5" aria-label={messages.shell.navAriaLabel}>
              <span
                aria-hidden="true"
                className="nav-indicator"
                style={{
                  width: `${navIndicator.width}px`,
                  transform: `translate3d(${navIndicator.left}px, 0, 0)`,
                  opacity: navIndicator.visible ? 1 : 0,
                }}
              />
              {siteConfig.nav.map(({ href, label }) => {
                const active = !footerPageOpen && pathname === href
                return (
                  <Link
                    key={href}
                    ref={(el) => { navLinkRefs.current[href] = el }}
                    href={href}
                    scroll={false}
                    aria-current={active ? 'page' : undefined}
                    className={`tactile relative z-10 min-w-0 flex-1 whitespace-nowrap h-9 px-1 rounded-micro lg:flex-none lg:px-4 flex items-center justify-center text-control no-underline ${active ? 'text-ink-primary font-semibold' : 'text-ink-secondary font-medium hover:text-ink-primary'}`}
                    prefetch={false}
                    onPointerEnter={(event) => { if (event.pointerType === 'mouse') warmRoute(href) }}
                    onPointerDown={(event) => { if (event.pointerType !== 'mouse') warmRoute(href) }}
                    onFocus={() => warmRoute(href)}
                    onNavigate={(event) => navigateToModule(href, event)}
                  >
                    {label}
                    <StudyNavigationStatus />
                  </Link>
                )
              })}
            </nav>

            <div className="pointer-events-auto flex items-center justify-end gap-1 shrink-0 lg:gap-2">
              <a
                className="icon-btn relative no-underline"
                href={siteConfig.hashes.chat}
                aria-label={messages.shell.openChatAria}
                aria-describedby={sharedUnread ? unreadDescriptionId : undefined}
                onClick={(event) => openFooterPage(event)}
                onPointerEnter={() => warmChat(userId)}
                onPointerDown={() => warmChat(userId)}
                onFocus={() => warmChat(userId)}
              >
                <ChatBubbleIcon />
                {sharedUnread && <UnreadDot className="absolute top-2 right-2" />}
              </a>
              <Button variant="icon" onClick={toggleTheme} aria-label={messages.shell.toggleThemeAria}>
                <span key={resolvedTheme} className="inline-flex animate-icon-swap">{themeIcon}</span>
              </Button>
              <Button
                variant="icon"
                className="relative lg:hidden"
                aria-label={messages.shell.openOverviewAria}
                aria-haspopup="dialog"
                onClick={(event) => {
                  event.currentTarget.focus({ preventScroll: true })
                  setOverviewOpen(true)
                }}
              >
                <OverviewIcon />
                {(unread || sharedUnread) && <UnreadDot className="absolute top-2 right-2" />}
              </Button>
              <Link
                className="icon-btn relative no-underline"
                href={siteConfig.routes.account}
                aria-label={messages.common.accountLabel}
                onNavigate={navigateFromExam}
                onPointerEnter={() => warmImage(siteConfig.assets.wordmark)}
                onFocus={() => warmImage(siteConfig.assets.wordmark)}
              >
                <UserIcon />
                <StudyNavigationStatus />
              </Link>
            </div>
          </div>
        </header>

        {/* Main canvas */}
        <main className={`max-w-shell w-full mx-auto px-5 lg:px-7 flex-1 ${viewportPageOpen ? 'study-panel-main' : 'pt-4 lg:pt-7 pb-6 lg:pb-12'}`}>
          {pathname === siteConfig.routes.practice && !footerPageOpen && (
            <button
              type="button"
              className="btn-surface min-w-0 max-w-full mb-4 px-3 py-2 rounded-control inline-flex items-center gap-2 text-left lg:hidden"
              aria-label={messages.shell.openSettingsAria}
              aria-haspopup="dialog"
              onClick={(event) => {
                event.currentTarget.focus({ preventScroll: true })
                setMobileSettingsOpen(true)
              }}
            >
              <span className="min-w-0 flex flex-col">
                <span className="text-xs font-medium text-ink-secondary">{mobileSubtitle}</span>
                <span className="mt-0.5 text-sm font-semibold truncate text-ink-primary">{mobileTitle}</span>
              </span>
              <ChevronDownIcon />
            </button>
          )}
          {preferences.syncFailed && !footerPageOpen && (
            <div className="mb-4 px-4 py-3 rounded-control bg-wrong-fill text-wrong-ink text-control flex items-center justify-between gap-3" role="status">
              <span>{messages.shell.syncError}</span>
              <Button variant="surface" size="xs" className="bg-canvas text-ink-primary" onClick={() => void preferences.retry()}>
                {messages.shell.retrySync}
              </Button>
            </div>
          )}
          <div key={pathname} hidden={footerPageOpen} inert={footerPageOpen}>{children}</div>
          {chatOpen && <PublicChat backHref={pathname} userId={userId} onBack={closeFooterPage} onRead={updateSharedUnread} />}
          {(feedbackOpen || authorChatOpen) && (
            <div hidden={!feedbackOpen} className={feedbackOpen ? 'flex flex-1 min-h-0 flex-col overflow-hidden' : undefined}>
              <FeedbackPage
                pathname={pathname}
                userId={userId}
                active={feedbackOpen}
                unread={unread}
                onBack={closeFooterPage}
                warmAuthorChat={() => { void loadAuthorChat().catch(() => {}) }}
                onOpenAuthorChat={(event) => { if (openFooterPage(event, true)) setAuthorChatRequested(true) }}
              />
            </div>
          )}
          {authorChatOpen && (
            <AuthorChatPage
              userId={userId}
              author={author}
              threadId={threadId}
              allowCreate={authorChatRequested}
              onRead={updateUnread}
              onBack={backFromAuthorChat}
              onOpenThread={(event) => openFooterPage(event, true)}
            />
          )}
          {sponsorOpen && (
            <section className="max-w-sponsor mx-auto py-4 animate-view-enter" aria-labelledby="sponsor-title">
              <ActionLink variant="surface" size="sm" className="mb-6" href={pathname} onClick={closeFooterPage}>
                {messages.common.backToPractice}
              </ActionLink>
              {sponsorSlot}
            </section>
          )}
        </main>

        <span id={unreadDescriptionId} hidden>{messages.common.unreadBadgeText}</span>

        <footer hidden={viewportPageOpen} className="community-footer mx-auto w-full max-w-shell px-5 lg:px-7">
          <div className="border-t border-0 border-solid border-surface-hover py-4 flex flex-col items-center gap-3 sm:flex-row sm:justify-between">
            <nav aria-label="社区与支持" className="flex items-center justify-center gap-4 sm:gap-5">
              <a className="community-link" aria-label="打开聊天区" href={siteConfig.hashes.chat}
                aria-describedby={sharedUnread ? unreadDescriptionId : undefined}
                onClick={(event) => openFooterPage(event)} onPointerEnter={() => warmChat(userId)} onFocus={() => warmChat(userId)}>
                <span className="community-icon"><ChatBubbleIcon />{sharedUnread && <UnreadDot className="absolute right-0 top-0" />}</span>
                {messages.shell.chatLink}
              </a>
              <a className="community-link" aria-label="打开意见反馈页面" href={siteConfig.hashes.feedback}
                aria-describedby={unread ? unreadDescriptionId : undefined} onClick={(event) => openFooterPage(event)}>
                <span className="community-icon"><MailboxIcon />{unread && <UnreadDot className="absolute right-0 top-0" />}</span>
                {messages.shell.feedbackLink}
              </a>
              <a className="community-link" aria-label="打开友情赞助页面" href={siteConfig.hashes.sponsor}
                onClick={(event) => openFooterPage(event)} onPointerEnter={() => warmImage(siteConfig.assets.sponsorQr)} onFocus={() => warmImage(siteConfig.assets.sponsorQr)}>
                <span className="community-icon"><SponsorIcon /></span>
                {messages.shell.sponsorLink}
              </a>
            </nav>
            <span className="font-credit text-base text-ink-secondary" lang="en">{siteConfig.visibleCredit}</span>
          </div>
        </footer>

        {/* Mobile Drawer 1: Practice settings & navigation */}
        <BottomDrawer
          open={mobileSettingsOpen}
          onClose={() => setMobileSettingsOpen(false)}
          title={messages.shell.drawerSettingsTitle}
          closeLabel={messages.common.done}
          bodyClassName="flex flex-col gap-6"
        >
          {pathname === '/' && (
            <>
              <div>
                <div className="text-xs font-medium text-ink-muted mb-2.5">{messages.shell.sectionModes}</div>
                <div className="flex flex-wrap gap-2">
                  {siteConfig.practiceModes.map((entry) => (
                    <Fragment key={entry.id}>
                      <Button
                        variant={practiceMode === entry.id ? 'selected' : 'surface'}
                        size="md"
                        className="h-10 text-control"
                        aria-pressed={practiceMode === entry.id}
                        onClick={() => { if (practiceMode !== entry.id) preferences.save({ practice: { ...practicePref, mode: entry.id } }) }}
                      >
                        {entry.label}
                      </Button>
                      {entry.id === 'sequence' && (
                        <Button
                          variant={practiceOnlyUndone ? 'selected' : 'surface'}
                          size="md"
                          className="h-10 text-control"
                          aria-pressed={practiceOnlyUndone}
                          onClick={() => preferences.save({ [practiceUndonePreference]: !practiceOnlyUndone })}
                        >
                          {messages.shell.onlyUndone}
                        </Button>
                      )}
                    </Fragment>
                  ))}
                </div>
              </div>
              {topicEntries.length > 0 && (
                <div>
                  <div className="text-xs font-medium text-ink-muted mb-2.5">{messages.shell.sectionTopics}</div>
                  <div className="flex flex-col gap-2">
                    {topicEntries.map((entry) => {
                      const active = practiceMode === 'topic' && activeTopic?.id === entry.id
                      return (
                        <button
                          key={entry.id}
                          type="button"
                          className={`tactile px-4 py-3.5 rounded-control flex items-center justify-between gap-3 text-left ${active ? 'bg-selected-fill text-selected-ink' : 'bg-surface text-ink-primary'}`}
                          onClick={() => {
                            preferences.save({ practice: { ...practicePref, mode: 'topic', topic: entry.id } })
                            setMobileSettingsOpen(false)
                          }}
                        >
                          <span className="text-body font-medium leading-snug">{entry.name}</span>
                          <span className={`tabular-nums text-xs shrink-0 ${active ? 'text-selected-ink' : 'text-ink-muted'}`}>{messages.common.questionCount(entry.count)}</span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </BottomDrawer>

        {/* Mobile Drawer 2: Study overview & community */}
        <BottomDrawer
          open={overviewOpen}
          onClose={() => setOverviewOpen(false)}
          closeLabel={messages.common.close}
          headerContent={(
            <div className="flex items-center gap-3">
              <Image className="rounded-full bg-white shrink-0 object-contain" src={siteConfig.assets.crest} alt="" width={siteConfig.imageDimensions.drawerCrest} height={siteConfig.imageDimensions.drawerCrest} unoptimized />
              <div>
                <h2 className="font-serif m-0 text-drawer-title font-bold">{messages.shell.drawerOverviewTitle}</h2>
                <div className="mt-1 flex items-center gap-2 flex-wrap">
                  <span className="text-meta text-ink-secondary">{siteConfig.title}</span>
                </div>
              </div>
            </div>
          )}
          bodyClassName="flex flex-col gap-5"
        >
          <div className="grid grid-cols-3 gap-2.5">
            <StatTile label={messages.common.practicedStat} value={statValues?.attempted ?? '—'} />
            <StatTile label={messages.common.wrongStat} value={statValues?.wrong ?? '—'} valueClassName="text-wrong-ink" />
            <StatTile label={messages.common.favoriteStat} value={statValues?.favorites ?? '—'} />
          </div>
          <div className="flex flex-wrap gap-2">
            <ActionLink variant="surface" size="md" className="h-10 text-control" href={siteConfig.hashes.chat} onClick={(event) => openFooterPage(event)}>
              <ChatBubbleIcon />{messages.shell.chatLink}{sharedUnread && <UnreadDot />}
            </ActionLink>
            <ActionLink variant="surface" size="md" className="h-10 text-control" href={siteConfig.hashes.feedback} onClick={(event) => openFooterPage(event)}>
              <MailboxIcon size={16} />{messages.shell.feedbackLink}{unread && <UnreadDot />}
            </ActionLink>
            <ActionLink variant="surface" size="md" className="h-10 text-control" href={siteConfig.hashes.sponsor} onClick={(event) => openFooterPage(event)}>
              <SponsorIcon />{messages.shell.sponsorLink}
            </ActionLink>
            <Link className="btn-surface h-10 px-4 rounded-compact inline-flex items-center text-control font-medium no-underline" href={siteConfig.routes.account} onClick={() => setOverviewOpen(false)} onNavigate={navigateFromExam}>
              {messages.common.accountManage}
            </Link>
          </div>
          <div className="flex flex-col items-center gap-1.5 text-center" lang="en">
            <span className="font-credit text-base text-ink-secondary">{siteConfig.visibleCredit}</span>
          </div>
        </BottomDrawer>
      </div>
    </StudyContext.Provider>
  )
}
