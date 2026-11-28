import { BrandMark } from '@/components/brand-mark'
import { messages } from '@/config/messages'
import { isSiteAuthor } from '@/features/auth/server'
import { loadStudyUser } from '@/features/auth/study-access'
import { SponsorCard } from '@/features/study/sponsor-card'
import { StudyShell } from '@/features/study/study-shell'
import { initialStudyPreferences, initialStudyStats, initialStudyTopics } from '@/server/study-bootstrap'

export default async function StudyLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const auth = await loadStudyUser()

  if (!auth.available) {
    return (
      <main className="min-h-dvh bg-canvas flex items-center justify-center px-5">
        <div className="p-6 rounded-option bg-surface text-center max-w-sm" role="alert">
          <p className="m-0 text-sm text-ink-secondary">{messages.shell.authUnavailable}</p>
        </div>
      </main>
    )
  }
  if (!auth.user) return children

  const [initialPreferences, initialStats, initialTopics] = await Promise.all([
    initialStudyPreferences(auth.user.id),
    initialStudyStats(auth.user.id),
    initialStudyTopics(),
  ])

  return (
    <StudyShell
      userId={auth.user.id}
      author={isSiteAuthor(auth.user)}
      initialPreferences={initialPreferences}
      initialStats={initialStats}
      initialTopics={initialTopics}
      brandSlot={<BrandMark />}
      sponsorSlot={<SponsorCard />}
      key={auth.user.id}
    >
      {children}
    </StudyShell>
  )
}
