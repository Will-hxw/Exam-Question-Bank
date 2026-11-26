import { loadStudyUser, StudyPage } from '@/features/auth/study-access'
import { Practice } from '@/features/study/practice'
import { initialPracticeBank } from '@/server/study-bootstrap'

export default async function PracticePage() {
  const access = await loadStudyUser()
  const bootstrap = access.available && access.user ? initialPracticeBank(access.user.id) : undefined
  return <StudyPage path="/"><Practice bootstrap={bootstrap} /></StudyPage>
}
