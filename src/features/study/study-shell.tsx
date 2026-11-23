'use client'

import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useSyncExternalStore, useState } from 'react'
import { type QuestionState, type StudyStats, type Topic, writeJson } from './api'
import { useAttemptQueue } from './use-attempt-queue'
import { useStudyData } from './use-study-data'

const nav = [
  { href: '/', label: '刷题' },
  { href: '/exam', label: '模拟考试' },
  { href: '/questions', label: '总题库' },
  { href: '/wrong', label: '错题集' },
  { href: '/favorites', label: '收藏夹' },
]

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

function closeSponsor(event: React.MouseEvent<HTMLAnchorElement>) {
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
  const examActive = useRef(false)
  const markExamActive = useCallback((active: boolean) => { examActive.current = active }, [])
  const refreshMe = useCallback(() => setRevision((previous) => previous + 1), [])
  const stats = useStudyData<StudyStats>('/api/me/stats', revision)
  const topics = useStudyData<{ topics: Topic[] }>('/api/public/topics')
  const attempts = useAttemptQueue(userId, refreshMe)

  async function setFavorite(id: string, favorite: boolean) {
    await writeJson(`/api/me/favorites/${id}`, userId, 'PUT', { favorite })
    refreshMe()
  }

  async function removeWrong(id: string) {
    await writeJson(`/api/me/wrong/${id}`, userId, 'DELETE')
    refreshMe()
  }

  function confirmLeaveExam() {
    return !examActive.current || window.confirm('正在考试中，确定离开吗？你可以从考试入口继续草稿。')
  }

  return { userId, revision, stats, topics, attempts, setFavorite, removeWrong, refreshMe, markExamActive, confirmLeaveExam }
}

const StudyContext = createContext<ReturnType<typeof useStudySession> | null>(null)

export function useStudySessionContext() {
  const context = useContext(StudyContext)
  if (!context) throw new Error('Study layout is required')
  return context
}

export function useQuestionStates(ids: string[]) {
  const { revision } = useStudySessionContext()
  const params = new URLSearchParams({ ids: ids.join(',') })
  return useStudyData<{ states: Record<string, QuestionState> }>(ids.length ? `/api/me/question-state?${params}` : null, revision)
}

export function StudyShell({ userId, children }: { userId: string; children: ReactNode }) {
  const pathname = usePathname()
  const sponsorOpen = useSyncExternalStore(subscribeHash, currentHash, emptyHash) === '#sponsor'
  const toggleTheme = useTheme()
  const session = useStudySession(userId)
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
              <span className="site-title-text">重庆大学</span>入党积极分子练习
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
              return <Link key={href} href={href} aria-current={active ? 'page' : undefined} className={active ? 'active' : undefined} prefetch={false}
                onNavigate={href === '/exam' ? undefined : navigateFromExam}>{label}</Link>
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
              <li>练习内容仅供学习参考</li>
              <li>作者：20230537 六只</li>
              <li>遇到问题请联系 QQ 1176843521</li>
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
