'use client'

import Image from 'next/image'
import Link, { useLinkStatus } from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useSyncExternalStore, useState } from 'react'
import { libraryPageSize, questionUrl, readPublic, requestJson, StudyRequestError, type QuestionState, type StudyStats, type Topic, writeJson } from './api'
import { useAttemptQueue } from './use-attempt-queue'
import { useStudyData } from './use-study-data'

const nav = [
  { href: '/', label: '刷题' },
  { href: '/exam', label: '模拟考试' },
  { href: '/questions', label: '总题库' },
  { href: '/wrong', label: '错题集' },
  { href: '/favorites', label: '收藏夹' },
]

const libraryFirstPage = questionUrl({ limit: libraryPageSize })
const routePrefetchOrder = ['/questions', '/exam', '/wrong', '/favorites', '/']
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

function closeSponsor(event: { preventDefault: () => void }) {
  event.preventDefault()
  const url = new URL(location.href)
  url.hash = ''
  history.replaceState(history.state, '', url)
  window.dispatchEvent(new HashChangeEvent('hashchange'))
}

const themePreferenceKey = 'cqu-study-color-scheme'

function useTheme() {
  useEffect(() => {
    const preference = window.matchMedia('(prefers-color-scheme: dark)')
    function applyPreference() {
      let value: string | null = null
      try { value = localStorage.getItem(themePreferenceKey) } catch { /* Use the system theme when storage is unavailable. */ }
      document.documentElement.dataset.theme = value === 'dark' || (!value && preference.matches) ? 'dark' : 'light'
    }
    applyPreference()
    preference.addEventListener('change', applyPreference)
    window.addEventListener('storage', applyPreference)
    return () => {
      preference.removeEventListener('change', applyPreference)
      window.removeEventListener('storage', applyPreference)
    }
  }, [])

  return () => {
    const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'
    document.documentElement.dataset.theme = theme
    try { localStorage.setItem(themePreferenceKey, theme) } catch { /* The current page still uses the selected theme. */ }
  }
}

function useStudySession(userId: string) {
  const [revision, setRevision] = useState(0)
  const stateRevision = useRef(0)
  const stateReads = useRef(new Map<string, QuestionStateRead>())
  const [knownStates, setKnownStates] = useState<Record<string, Partial<QuestionState>>>({})
  const favoriteWrites = useRef(new Map<string, FavoriteWrite>())
  const [pendingFavorites, setPendingFavorites] = useState<Record<string, boolean>>({})
  const [favoriteErrors, setFavoriteErrors] = useState<Record<string, string>>({})
  const examActive = useRef(false)
  const markExamActive = useCallback((active: boolean) => { examActive.current = active }, [])
  const refreshMe = useCallback(() => {
    stateRevision.current += 1
    setRevision(stateRevision.current)
  }, [])
  const stats = useStudyData<StudyStats>('/api/me/stats', revision, { keepPreviousData: true })
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
    userId, revision, stats, topics, attempts, knownStates, readQuestionStates, prefetchQuestionStates,
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

export function StudyShell({ userId, children }: { userId: string; children: ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const sponsorOpen = useSyncExternalStore(subscribeHash, currentHash, emptyHash) === '#sponsor'
  const toggleTheme = useTheme()
  const session = useStudySession(userId)
  const [warmRouteCount, setWarmRouteCount] = useState(0)
  const practiceReady = Boolean(session.topics.data)
  useEffect(() => {
    if (warmRouteCount >= routePrefetchOrder.length || !practiceReady) return
    const timer = setTimeout(() => {
      if (!navigator.onLine || document.visibilityState !== 'visible') return
      if (warmRouteCount === 0) void readPublic(libraryFirstPage).catch(() => {})
      setWarmRouteCount((count) => count + 1)
    }, warmRouteCount === 0 ? 400 : 220)
    return () => clearTimeout(timer)
  }, [pathname, warmRouteCount, practiceReady])

  function warmRoute(href: string) {
    if (pathname === href || !navigator.onLine) return
    if (href === '/questions') void readPublic(libraryFirstPage).catch(() => {})
    router.prefetch(href)
  }
  const clearCurrentExam = useCallback(() => {
    try { sessionStorage.removeItem(`cqu-study-current-exam:${userId}`) } catch { /* Cloud drafts are unaffected. */ }
  }, [userId])
  useEffect(() => {
    if (pathname !== '/exam') clearCurrentExam()
  }, [pathname, clearCurrentExam])

  function navigateFromExam(event: { preventDefault: () => void }) {
    if (pathname !== '/exam') return
    if (!session.confirmLeaveExam()) { event.preventDefault(); return }
    clearCurrentExam()
  }

  return (
    <StudyContext.Provider value={session}>
      <div className="study-theme">
        <div className="study-shell">
          <header id="site-header">
            <a className="site-title" href="https://www.12371.cn/special/zxzc/" target="_blank" rel="noreferrer">
              <Image className="site-crest" src="/cqu-crest.png" alt="" width={38} height={38} unoptimized />
              <span><span className="site-title-text">重庆大学</span><span className="site-title-text">入党积极分子练习</span></span>
            </a>
            <div className="site-header-right">
              <button className="dark-toggle" type="button" onClick={toggleTheme} aria-label="切换明暗主题">
                <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3a9 9 0 1 0 9 9c0-.46-.04-.92-.1-1.36a5.39 5.403 0 0 1-4.4 2.26 5.403 5.403 0 0 1-3.14-9.8c-.44-.06-.9-.1-1.36-.1z" /></svg>
              </button>
              <Link className="account-link" href="/account" onNavigate={navigateFromExam}>账号</Link>
            </div>
          </header>
          <nav id="top-nav" aria-label="学习导航">
            {nav.map(({ href, label }) => {
              const active = !sponsorOpen && pathname === href
              return <Link key={href} href={href} aria-current={active ? 'page' : undefined} className={active ? 'active' : undefined}
                prefetch={pathname !== href && routePrefetchOrder.indexOf(href) < warmRouteCount}
                onPointerEnter={(event) => {
                  if (event.pointerType === 'mouse') warmRoute(href)
                }}
                onPointerDown={(event) => {
                  if (event.pointerType !== 'mouse') warmRoute(href)
                }}
                onFocus={() => warmRoute(href)}
                onNavigate={(event) => {
                  if (sponsorOpen && href === pathname) closeSponsor(event)
                  else if (href !== '/exam') navigateFromExam(event)
                }}>
                {label}<StudyNavigationStatus />
              </Link>
            })}
          </nav>
          <main className="study-main">
            <div hidden={sponsorOpen}>{children}</div>
            {sponsorOpen && (
              <section className="sponsor-page" aria-labelledby="sponsor-title">
                <a className="btn btn-sm sponsor-back" href={pathname} onClick={closeSponsor}>← 返回练习</a>
                <div className="sponsor-hero">
                  <span className="sponsor-heart" aria-hidden="true">💖</span>
                  <h1 id="sponsor-title">友情赞助</h1>
                  <p>如果有帮助的话，感谢支持维护🥰</p>
                  <p>如果遗憾没帮助，我会努力改善🥹</p>
                </div>
                <div className="sponsor-qr-card">
                  <Image src="/wechat.png" alt="微信收款码" width={309} height={309} loading="lazy" unoptimized />
                </div>
              </section>
            )}
          </main>
          <footer className="site-footer">
            <ul className="footer-notes">
              <li><span className="footer-latin" lang="en">Bug </span>或瑕疵有奖</li>
              <li>作者：计算机学院 <span className="footer-latin">20230537</span> 六只</li>
              <li>遇到问题请联系 <span className="footer-latin" lang="en">QQ 1176843521</span></li>
            </ul>
            <a className="footer-sponsor-link" href="#sponsor" aria-label="打开友情赞助页面">
              <span className="footer-sponsor-icon" aria-hidden="true">💌</span>
              友情赞助
            </a>
          </footer>
        </div>
      </div>
    </StudyContext.Provider>
  )
}
