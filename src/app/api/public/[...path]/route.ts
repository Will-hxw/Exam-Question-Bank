import { bankRelease, explanation, practiceBookmarkPosition, publicQuestions, questionFilters, topics } from '@/server/content'
import { HttpError, route, uuid } from '@/server/http'

export const GET = route(async (request: Request, { params }: { params: Promise<{ path: string[] }> }) => {
  const path = await params
  if (path.path.length === 1 && path.path[0] === 'topics' && !new URL(request.url).search) return topics()
  if (path.path.length === 1 && path.path[0] === 'bank-release' && !new URL(request.url).search) return bankRelease()
  if (path.path.length === 1 && path.path[0] === 'questions') return publicQuestions(questionFilters(new URL(request.url)))
  if (path.path.length === 3 && path.path[0] === 'questions' && path.path[2] === 'position') {
    return practiceBookmarkPosition(uuid(path.path[1]), new URL(request.url).searchParams)
  }
  if (path.path.length === 3 && path.path[0] === 'questions' && path.path[2] === 'explanation') {
    if (new URL(request.url).search) throw new HttpError(400, '题目解析不支持附加参数。')
    return explanation(uuid(path.path[1]))
  }
  throw new HttpError(404, '接口不存在。')
}, { 'Cache-Control': 'public, max-age=0, must-revalidate' })
