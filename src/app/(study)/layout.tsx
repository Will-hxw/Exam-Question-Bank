import { isSiteAuthor } from '@/features/auth/server'
import { loadStudyUser } from '@/features/auth/study-access'
import { StudyShell } from '@/features/study/study-shell'
import { initialStudyPreferences, initialStudyStats } from '@/server/study-bootstrap'
import '@/features/study/study.css'

export default async function StudyLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const auth = await loadStudyUser()

  if (!auth.available) {
    return <main className="study-theme"><div className="study-shell">
      <div className="empty-state" role="alert">
        <p>暂时无法验证登录状态。请稍后刷新页面。</p>
      </div>
    </div></main>
  }
  if (!auth.user) return children

  const initialPreferences = initialStudyPreferences(auth.user.id)
  const initialStats = initialStudyStats(auth.user.id)
  return <StudyShell userId={auth.user.id} author={isSiteAuthor(auth.user)}
    initialPreferences={initialPreferences} initialStats={initialStats} key={auth.user.id}>
    {children}
  </StudyShell>
}
