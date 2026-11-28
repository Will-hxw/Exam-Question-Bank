import { siteConfig } from '@/config/site'
import { StudyPage } from '@/features/auth/study-access'
import { Library } from '@/features/study/library'

export default function FavoritesPage() {
  return <StudyPage path={siteConfig.routes.favorites}><Library list="favorite" /></StudyPage>
}
