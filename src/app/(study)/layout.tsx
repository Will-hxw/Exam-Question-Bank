import { isSiteAuthor } from '@/features/auth/server'
import { loadStudyUser } from '@/features/auth/study-access'
import { StudyShell } from '@/features/study/study-shell'
import { readStudyPreferences, studyStats } from '@/server/learning'
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

  const initialPreferences = readStudyPreferences(auth.user.id).catch(() => null)
  const initialStats = studyStats(auth.user.id).catch(() => null)
  return <StudyShell userId={auth.user.id} author={isSiteAuthor(auth.user)}
    initialPreferences={initialPreferences} initialStats={initialStats} key={auth.user.id}>
    {children}
  </StudyShell>
}
