import { siteConfig } from '@/config/site'
import { StudyPage } from '@/features/auth/study-access'
import { Library } from '@/features/study/library'

export default function QuestionsPage() {
  return <StudyPage path={siteConfig.routes.questions}><Library list="all" /></StudyPage>
}
