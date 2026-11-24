import { createExam, examDetails, examHistory, replayExam, saveExam } from '@/server/exams'
import { HttpError, parseBody, route, uuid } from '@/server/http'
import { account } from '@/server/learning'

type Context = { params: Promise<{ path?: string[] }> }

// A full draft may contain 100 answers with six UUIDs each, plus marked questions.
const examDraftBodyLimit = 40000

export const GET = route(async (request: Request, context: Context) => {
  const user = await account(request)
  const { path = [] } = await context.params
  if (!path.length) return examHistory(user)
  if (path.length === 1) return examDetails(user, uuid(path[0]))
  throw new HttpError(404, '接口不存在。')
})

export const POST = route(async (request: Request, context: Context) => {
  const user = await account(request, true)
  const { path = [] } = await context.params
  if (!path.length) {
    const length = request.headers.get('content-length')
    const hasBody = length !== '0' && (length !== null || request.headers.has('content-type') || request.headers.has('transfer-encoding'))
    return createExam(user, hasBody ? (await parseBody(request, 1024)).questionCount : undefined)
  }
  if (path.length === 2 && path[1] === 'submit') return saveExam(user, uuid(path[0]), await parseBody(request, examDraftBodyLimit), true)
  if (path.length === 2 && path[1] === 'replay') return replayExam(user, uuid(path[0]))
  throw new HttpError(404, '接口不存在。')
})

export const PUT = route(async (request: Request, context: Context) => {
  const user = await account(request, true)
  const { path = [] } = await context.params
  if (path.length === 1) return saveExam(user, uuid(path[0]), await parseBody(request, examDraftBodyLimit), false,
    new URL(request.url).searchParams.get('ack') === '1')
  throw new HttpError(404, '接口不存在。')
})
