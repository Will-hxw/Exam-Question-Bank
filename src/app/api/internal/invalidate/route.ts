import { createHash, timingSafeEqual } from 'node:crypto'
import { revalidateTag } from 'next/cache'
import { CONTENT_TAG } from '@/server/content'
import { HttpError, route } from '@/server/http'

export const POST = route(async (request: Request) => {
  const expected = process.env.CONTENT_INVALIDATION_SECRET
  const header = request.headers.get('authorization') || ''
  if (!expected || expected.length < 32 || !header.startsWith('Bearer ')) throw new HttpError(404, '接口不存在。')

  const digest = (value: string) => createHash('sha256').update(value).digest()
  if (!timingSafeEqual(digest(header.slice(7)), digest(expected))) throw new HttpError(404, '接口不存在。')
  revalidateTag(CONTENT_TAG, { expire: 0 })
  return { ok: true }
})
