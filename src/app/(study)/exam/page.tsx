import { siteConfig } from '@/config/site'
import { loadStudyUser, StudyPage } from '@/features/auth/study-access'
import { Exam } from '@/features/study/exam'
import { examHistory } from '@/server/exams'

export default async function ExamPage() {
  const access = await loadStudyUser()
  const initialHistory = access.available && access.user ? await examHistory(access.user.id).catch(() => null) : null
  return (
    <StudyPage path={siteConfig.routes.exam}>
      <Exam initialHistory={initialHistory} />
    </StudyPage>
  )
}
