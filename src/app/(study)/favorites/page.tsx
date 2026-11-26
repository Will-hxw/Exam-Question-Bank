import { StudyPage } from '@/features/auth/study-access'
import { Library } from '@/features/study/library'

export default function FavoritesPage() {
  return <StudyPage path="/favorites"><Library list="favorite" /></StudyPage>
}
