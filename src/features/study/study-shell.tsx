'use client'

import Image from 'next/image'
import dynamic from 'next/dynamic'
import Link, { useLinkStatus } from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createContext, type MouseEvent, type ReactNode, useCallback, useContext, useEffect, useRef, useSyncExternalStore, useState } from 'react'
import { authWordmarkImage, publicAuthorAvatar, sponsorQrImage } from '@/ui-images'
import { warmSharedChat } from '../chat/shared-chat-cache'
import { authorChatHash, unreadDescriptionId } from '../chat/types'
import { useChatUnread } from '../chat/use-chat-unread'
import { questionUrl, readPublic, requestJson, StudyRequestError, type QuestionState, type StudyStats, type Topic, writeJson } from './api'
import { FeedbackPage, MailboxIcon } from './feedback-page'
import { libraryPath, readLibraryView, type StudyPreferences, useAccountStudyPreferences, useAccountStudyScroll } from './preferences'
import { useAttemptQueue } from './use-attempt-queue'
import { createPersonalStudyReads, useStudyData } from './use-study-data'

const loadChatPage = () => import('../chat/chat-page')
const PublicChat = dynamic(() => loadChatPage().then(({ PublicChat }) => PublicChat), {
  loading: () => <p className="empty-state" role="status">正在打开聊天区…</p>,
})
const loadAuthorChat = () => import('../chat/author-chat-page')
const AuthorChatPage = dynamic(loadAuthorChat, {
  loading: () => <p className="empty-state" role="status">正在打开作者对话…</p>,
})

function warmImage(src: string) {
  if (!navigator.onLine) return
  const image = new window.Image()
  image.src = src
}

function warmChat(userId: string) {
  if (!navigator.onLine) return
  warmImage(publicAuthorAvatar)
  void loadChatPage().catch(() => {})
  void warmSharedChat(userId).catch(() => {})
}

const nav = [
  { href: '/', label: '刷题' },
  { href: '/exam', label: '模拟考试' },
  { href: '/questions', label: '总题库' },
  { href: '/wrong', label: '错题集' },
  { href: '/favorites', label: '收藏夹' },
]

type QuestionStates = { states: Record<string, QuestionState> }
type QuestionStateRead = { revision: number; expiresAt: number; response: Promise<QuestionStates> }
type FavoriteWrite = { desired: boolean }

function statesPath(ids: string[]) {
  return `/api/me/question-state?${new URLSearchParams({ ids: ids.join(',') })}`
}

function StudyNavigationStatus() {
  const { pending } = useLinkStatus()
  return <span className="study-navigation-status" role="status">
    {pending && <span className="study-navigation-pending">正在切换页面</span>}
  </span>
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

function closeFooterPage(event: { preventDefault: () => void }) {
  event.preventDefault()
  const url = new URL(location.href)
  if (history.state?.studyFooterBack === url.pathname + url.search) {
    history.back()
    return
  }
  url.hash = ''
  history.replaceState(history.state, '', url)
  window.dispatchEvent(new HashChangeEvent('hashchange'))
}

function useTheme(theme: unknown, save: (edits: Record<string, unknown>) => void) {
  useEffect(() => {
    const preference = window.matchMedia('(prefers-color-scheme: dark)')
    function applyPreference() {
      document.documentElement.dataset.theme = theme === 'dark' || (theme !== 'light' && preference.matches) ? 'dark' : 'light'
    }
    applyPreference()
    preference.addEventListener('change', applyPreference)
    return () => preference.removeEventListener('change', applyPreference)
  }, [theme])

  return () => {
    const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'
    document.documentElement.dataset.theme = theme
    save({ theme })
  }
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
  const stats = useStudyData<StudyStats>('/api/me/stats', revision, { ...personalReads, initial: initialStats, keepPreviousData: true })
  const [bootstrapPreferences, setBootstrapPreferences] = useState<StudyPreferences>()
  useEffect(() => {
    let active = true
    void Promise.resolve(initialPreferences).then((value) => {
      if (value && active) setBootstrapPreferences(value)
    }, () => {})
    return () => { active = false }
  }, [initialPreferences])
  const preferences = useAccountStudyPreferences(userId, stats.data?.preferences ?? bootstrapPreferences, stats.loading)
  const topics = useStudyData<{ topics: Topic[] }>('/api/public/topics')
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
      const message = error instanceof StudyRequestError ? error.message : '收藏未保存，请重试。'
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
      setFavoriteErrors((previous) => ({ ...previous, [id]: '离线时无法更新收藏，请联网后重试。' }))
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
    return !examActive.current || window.confirm('正在考试中，确定离开吗？你可以从考试入口继续草稿。')
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

export function StudyShell({ userId, author, initialPreferences, initialStats, children }: {
  userId: string; author: boolean; initialPreferences: Promise<StudyPreferences | null>
  initialStats: Promise<StudyStats | null>; children: ReactNode
}) {
  const pathname = usePathname()
  const router = useRouter()
  const hash = useSyncExternalStore(subscribeHash, currentHash, emptyHash)
  const [initialFooterPath] = useState(() => {
    if (typeof window === 'undefined' || !/^#(?:chat|feedback|sponsor|author-chat(?:\/.*)?)$/.test(window.location.hash)) return null
    return window.location.pathname
  })
  const sponsorOpen = hash === '#sponsor'
  const feedbackOpen = hash === '#feedback'
  const chatOpen = hash === '#chat'
  const authorChatOpen = hash === authorChatHash || hash.startsWith(authorChatHash + '/')
  const [authorChatRequested, setAuthorChatRequested] = useState(false)
  const threadId = hash.startsWith(authorChatHash + '/') ? hash.slice(authorChatHash.length + 1) : undefined
  const footerPageOpen = sponsorOpen || feedbackOpen || chatOpen || authorChatOpen
  const { unread, sharedUnread, updateUnread, updateSharedUnread } = useChatUnread(userId, feedbackOpen || authorChatOpen)
  const session = useStudySession(userId, initialPreferences, initialStats)
  const { personalReads, preferences } = session
  const toggleTheme = useTheme(preferences.values.theme, preferences.save)
  useAccountStudyScroll(pathname, preferences)
  const publicLibrary = libraryPath('all', readLibraryView(preferences.values['library:all']))
  const wrongLibrary = libraryPath('wrong', readLibraryView(preferences.values['library:wrong']))
  const favoriteLibrary = libraryPath('favorite', readLibraryView(preferences.values['library:favorite']))
  const firstTopic = session.topics.data?.topics.find(({ count }) => count > 0)?.id
  const warmedLibrary = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (chatOpen) warmChat(userId)
  }, [chatOpen, userId])
  useEffect(() => {
    if (pathname === '/' && !preferences.ready && firstTopic && navigator.onLine) {
      void readPublic(questionUrl({ topic: firstTopic, offset: 0, limit: 15, practice: true })).catch(() => {})
    }
  }, [firstTopic, pathname, preferences.ready])
  useEffect(() => {
    if (pathname !== '/' || footerPageOpen || !firstTopic || !preferences.ready
      || !publicLibrary.startsWith('/api/public/') || warmedLibrary.current === publicLibrary) return
    const timer = setTimeout(() => {
      if (!navigator.onLine || document.hidden) return
      warmedLibrary.current = publicLibrary
      void readPublic(publicLibrary).catch(() => { warmedLibrary.current = undefined })
    }, 800)
    return () => clearTimeout(timer)
  }, [firstTopic, footerPageOpen, pathname, preferences.ready, publicLibrary])
  function warmRoute(href: string) {
    if (pathname === href || !navigator.onLine) return
    if (href === '/questions') void (publicLibrary.startsWith('/api/me/') ? personalReads.load(publicLibrary) : readPublic(publicLibrary)).catch(() => {})
    if (href === '/wrong' || href === '/favorites') {
      void personalReads.load(href === '/wrong' ? wrongLibrary : favoriteLibrary).catch(() => {})
    }
    router.prefetch(href)
  }
  function navigateFromExam(event: { preventDefault: () => void }) {
    if (pathname !== '/exam' || session.confirmLeaveExam()) return true
    event.preventDefault()
    return false
  }

  function openFooterPage(event: MouseEvent<HTMLAnchorElement>) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    const destination = new URL(event.currentTarget.href)
    event.preventDefault()
    if (destination.hash === hash || !navigateFromExam(event)) return
    if (footerPageOpen) {
      history.replaceState(history.state, '', destination)
    } else {
      history.pushState({ ...history.state, studyFooterBack: destination.pathname + destination.search }, '', destination)
    }
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  }

  return (
    <StudyContext.Provider value={session}>
      <div className="study-theme">
        <div className="study-shell">
          <header id="site-header">
            <a className="site-title" href="https://www.12371.cn/special/zxzc/" target="_blank" rel="noreferrer">
              <Image className="site-crest" src="/cqu-crest.png" alt="" width={38} height={38} unoptimized />
              <span className="site-title-name"><span className="site-title-text">重庆大学</span><span className="site-title-text">入党积极分子练习</span></span>
            </a>
            <div className="site-header-right">
              <button className="dark-toggle" type="button" onClick={toggleTheme} aria-label="切换明暗主题">
                <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3a9 9 0 1 0 9 9c0-.46-.04-.92-.1-1.36a5.39 5.403 0 0 1-4.4 2.26 5.403 5.403 0 0 1-3.14-9.8c-.44-.06-.9-.1-1.36-.1z" /></svg>
              </button>
              <Link className="account-link" href="/account" aria-label="账号" onNavigate={navigateFromExam}
                onPointerEnter={() => warmImage(authWordmarkImage)} onFocus={() => warmImage(authWordmarkImage)}>
                账号<StudyNavigationStatus />
              </Link>
            </div>
          </header>
          <nav id="top-nav" aria-label="学习导航">
            {nav.map(({ href, label }) => {
              const active = !footerPageOpen && pathname === href
              return <Link key={href} href={href} scroll={false} aria-current={active ? 'page' : undefined} className={active ? 'active' : undefined}
                prefetch={false}
                onPointerEnter={(event) => {
                  if (event.pointerType === 'mouse') warmRoute(href)
                }}
                onPointerDown={(event) => {
                  if (event.pointerType !== 'mouse') warmRoute(href)
                }}
                onFocus={() => warmRoute(href)}
                onNavigate={(event) => {
                  if (footerPageOpen && href === pathname) closeFooterPage(event)
                  else if ((href === '/exam' || navigateFromExam(event)) && href === initialFooterPath) {
                    // The initial Next.js route cache can include the footer fragment.
                    event.preventDefault()
                    if (href !== pathname) window.location.assign(href)
                  }
                }}>
                {label}<StudyNavigationStatus />
              </Link>
            })}
          </nav>
          <main className="study-main">
            {preferences.syncFailed && <p className="study-message error" role="status">
              学习设置暂未同步。 <button className="btn btn-sm" type="button" onClick={() => void preferences.retry()}>重试同步设置</button>
            </p>}
            <div hidden={footerPageOpen}>{children}</div>
            {chatOpen && <PublicChat backHref={pathname} userId={userId} onBack={closeFooterPage} onRead={updateSharedUnread} />}
            {(feedbackOpen || authorChatOpen) && <div hidden={!feedbackOpen}>
              <FeedbackPage pathname={pathname} userId={userId} active={feedbackOpen} unread={unread}
                onBack={closeFooterPage} warmAuthorChat={() => { void loadAuthorChat().catch(() => {}) }}
                onOpenAuthorChat={() => setAuthorChatRequested(true)} />
            </div>}
            {authorChatOpen && <AuthorChatPage userId={userId} author={author} threadId={threadId}
              allowCreate={authorChatRequested} onRead={updateUnread} />}
            {sponsorOpen && (
              <section className="sponsor-page" aria-labelledby="sponsor-title">
                <a className="btn btn-sm footer-page-back sponsor-back" href={pathname} onClick={closeFooterPage}>← 返回练习</a>
                <div className="sponsor-hero">
                  <span className="sponsor-heart" aria-hidden="true">💖</span>
                  <h1 id="sponsor-title">友情赞助</h1>
                  <p>如果有帮助的话，感谢支持维护🥰</p>
                  <p>如果遗憾没帮助，我会努力改善🥹</p>
                </div>
                <div className="sponsor-qr-card">
                  <Image src={sponsorQrImage} alt="微信收款码" width={309} height={309} fetchPriority="high" unoptimized />
                </div>
              </section>
            )}
          </main>
          <span id={unreadDescriptionId} hidden>有未读消息</span>
          <footer className="site-footer">
            <div className="footer-actions">
              <a className="footer-action" href="#chat" aria-label="打开聊天区" onClick={openFooterPage}
                aria-describedby={sharedUnread ? unreadDescriptionId : undefined}
                onPointerEnter={() => warmChat(userId)} onPointerDown={() => warmChat(userId)} onFocus={() => warmChat(userId)}>
                <span className="footer-action-icon footer-chat-icon" aria-hidden="true">
                  <svg width="23" height="23" viewBox="0 0 24 24" fill="none">
                    <path fill="currentColor" d="M7.5 5.5h6.6a5.8 5.8 0 0 1 0 11.6h-4.6l-4.7 3.1.7-3.6a5.8 5.8 0 0 1 2-11.1Z" />
                    <path d="M7.25 10.35h6.5m-6.5 2.85h4" stroke="#fff" strokeWidth="1.45" strokeLinecap="round" />
                    <path d="M19 1.7c.4 2.15 1.55 3.3 3.7 3.7-2.15.4-3.3 1.55-3.7 3.7-.4-2.15-1.55-3.3-3.7-3.7 2.15-.4 3.3-1.55 3.7-3.7Z"
                      fill="#f5ae2e" stroke="#fff" strokeWidth=".65" strokeLinejoin="round" />
                  </svg>
                  {sharedUnread && <span className="message-unread-dot" aria-hidden="true" />}
                </span>
                聊天区
              </a>
              <a className="footer-action" href="#feedback" aria-label="打开意见反馈页面"
                aria-describedby={unread ? unreadDescriptionId : undefined} onClick={openFooterPage}>
                <span className="footer-action-icon footer-feedback-icon">
                  <MailboxIcon />{unread && <span className="message-unread-dot" aria-hidden="true" />}
                </span>
                意见反馈
              </a>
              <a className="footer-action" href="#sponsor" aria-label="打开友情赞助页面"
                onClick={openFooterPage}
                onPointerEnter={() => warmImage(sponsorQrImage)} onFocus={() => warmImage(sponsorQrImage)}>
                <span className="footer-action-icon footer-sponsor-icon" aria-hidden="true">💌</span>
                友情赞助
              </a>
            </div>
            <p className="footer-credit" lang="en">Hua Xiaowei — ZJU</p>
          </footer>
        </div>
      </div>
    </StudyContext.Provider>
  )
}
