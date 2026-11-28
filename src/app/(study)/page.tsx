import { siteConfig } from '@/config/site'
import { loadStudyUser, StudyPage } from '@/features/auth/study-access'
import { Practice } from '@/features/study/practice'
import { initialPracticeBank } from '@/server/study-bootstrap'

export default async function PracticePage() {
  const access = await loadStudyUser()
  const bootstrap = access.available && access.user ? await initialPracticeBank(access.user.id) : null
  const initialSeed = crypto.randomUUID()
  return (
    <StudyPage path={siteConfig.routes.practice}>
      <Practice bootstrap={bootstrap} initialSeed={initialSeed} />
    </StudyPage>
  )
}
