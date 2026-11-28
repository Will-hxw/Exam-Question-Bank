import { siteConfig } from '@/config/site'
import { loadStudyUser, StudyPage } from '@/features/auth/study-access'
import { Library } from '@/features/study/library'
import { initialLibraryPage } from '@/server/study-bootstrap'

export default async function QuestionsPage() {
  const access = await loadStudyUser()
  const initialPage = access.available && access.user ? await initialLibraryPage(access.user.id) : null
  return (
    <StudyPage path={siteConfig.routes.questions}>
      <Library list="all" initialPage={initialPage} />
    </StudyPage>
  )
}
