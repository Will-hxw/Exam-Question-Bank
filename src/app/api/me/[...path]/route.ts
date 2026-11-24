import { questionFilters, questionPage } from '@/server/content'
import { HttpError, parseBody, route, uuid } from '@/server/http'
import { account, dismissWrong, favorite, questionStates, saveStudyPreferences, studyStats } from '@/server/learning'

type RouteContext = { params: Promise<{ path: string[] }> }

export const GET = route(async (request: Request, context: RouteContext) => {
  const user = await account(request)
  const { path } = await context.params
  if (path.length !== 1) throw new HttpError(404, '接口不存在。')
  const url = new URL(request.url)
  switch (path[0]) {
    case 'stats': return studyStats(user)
    case 'questions': return questionPage(questionFilters(url, true), user)
    case 'question-state': {
      const ids = url.searchParams.get('ids')?.split(',') ?? []
      if (ids.length < 1 || ids.length > 50) throw new HttpError(400, '每批应包含 1 至 50 道题。')
      return questionStates(user, [...new Set(ids.map(uuid))])
    }
    default: throw new HttpError(404, '接口不存在。')
  }
})

export const PUT = route(async (request: Request, context: RouteContext) => {
  const user = await account(request, true)
  const { path } = await context.params
  if (path.length === 1 && path[0] === 'preferences') return saveStudyPreferences(user, await parseBody(request, 16000))
  if (path.length !== 2 || path[0] !== 'favorites') throw new HttpError(404, '接口不存在。')
  const body = await parseBody(request, 128)
  return favorite(user, uuid(path[1]), body.favorite)
})

export const DELETE = route(async (request: Request, context: RouteContext) => {
  const user = await account(request, true)
  const { path } = await context.params
  if (path.length !== 2 || path[0] !== 'wrong') throw new HttpError(404, '接口不存在。')
  return dismissWrong(user, uuid(path[1]))
})
