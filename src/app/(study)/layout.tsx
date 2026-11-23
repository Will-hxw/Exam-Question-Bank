import { redirect } from 'next/navigation'
import { connection } from 'next/server'
import { getAuth, getVerifiedUser } from '@/features/auth/server'
import { StudyShell } from '@/features/study/study-shell'
import '@/features/study/study.css'

async function loadUser() {
  try {
    if (!getAuth()) return { available: false } as const
    return { available: true, user: await getVerifiedUser() } as const
  } catch {
    return { available: false } as const
  }
}

export default async function StudyLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  await connection()
  const auth = await loadUser()

  if (!auth.available) {
    return <main className="study-theme"><div className="study-shell">
      <div className="empty-state" role="alert">
        <p>暂时无法验证登录状态。请稍后刷新页面。</p>
      </div>
    </div></main>
  }
  if (!auth.user) redirect('/login')

  return <StudyShell userId={auth.user.id} key={auth.user.id}>{children}</StudyShell>
}
