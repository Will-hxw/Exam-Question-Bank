import { StudyPage } from '@/features/auth/study-access'
import { Library } from '@/features/study/library'

export default function WrongQuestionsPage() {
  return <StudyPage path="/wrong"><Library list="wrong" /></StudyPage>
}
