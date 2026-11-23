import { randomUUID } from 'node:crypto'

export class HttpError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message)
  }
}

const privateHeaders = { 'Cache-Control': 'private, no-store' }

export function route<T extends unknown[]>(
  handler: (...args: T) => Promise<unknown>,
  headers = privateHeaders,
) {
  return async (...args: T) => {
    try {
      return Response.json(await handler(...args), { headers })
    } catch (error) {
      if (error instanceof HttpError) {
        return Response.json({ error: error.message }, { status: error.status, headers: privateHeaders })
      }
      const requestId = randomUUID()
      console.error({ requestId, operation: 'api', error: error instanceof Error ? error.name : 'UnknownError' })
      return Response.json({ error: '服务暂时不可用，请重试。', requestId }, { status: 503, headers: privateHeaders })
    }
  }
}

export const uuidPattern = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i

export function uuid(value: unknown): string {
  if (typeof value !== 'string' || !uuidPattern.test(value)) throw new HttpError(400, '无效编号。')
  return value.toLowerCase()
}

export async function parseBody(request: Request, cap = 24000): Promise<Record<string, unknown>> {
  const type = request.headers.get('content-type')?.split(';')[0].trim().toLowerCase()
  if (type !== 'application/json') throw new HttpError(415, '请发送 JSON 请求。')
  const reader = request.body?.getReader()
  if (!reader) throw new HttpError(400, '请求为空。')
  const decoder = new TextDecoder()
  let bytes = 0
  let body = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    bytes += value.byteLength
    if (bytes > cap) {
      await reader.cancel()
      throw new HttpError(413, '请求超出大小限制。')
    }
    body += decoder.decode(value, { stream: true })
  }
  body += decoder.decode()
  try {
    const value = JSON.parse(body)
    if (value && typeof value === 'object' && !Array.isArray(value)) return value
  } catch {
    throw new HttpError(400, '请求格式有误。')
  }
  throw new HttpError(400, '请求格式有误。')
}

export function sameOrigin(request: Request) {
  const origin = process.env.NEXT_PUBLIC_SITE_URL || new URL(request.url).origin
  if (request.headers.get('origin') !== new URL(origin).origin) throw new HttpError(403, '请求来源无效。')
}
