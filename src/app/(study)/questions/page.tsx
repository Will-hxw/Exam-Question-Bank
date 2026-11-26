import { StudyPage } from '@/features/auth/study-access'
import { Library } from '@/features/study/library'

export default function QuestionsPage() {
  return <StudyPage path="/questions"><Library list="all" /></StudyPage>
}
