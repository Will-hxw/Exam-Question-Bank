import { query } from '@/server/db'
import { HttpError, route, uuid } from '@/server/http'
import { account } from '@/server/learning'

export const GET = route(async (request: Request) => {
  const user = await account(request)
  const id = uuid(new URL(request.url).searchParams.get('id'))
  const [avatar] = await query<{ image: string }>(`
    SELECT encode(a.image, 'base64') AS image
    FROM chat_avatars a
    WHERE a.id = $1 AND (a.user_id = $2 OR EXISTS (SELECT 1 FROM chat_messages m WHERE m.user_id = a.user_id))
  `, [id, user])
  if (!avatar) throw new HttpError(404, '头像不存在。')
  return new Response(Uint8Array.from(Buffer.from(avatar.image, 'base64')), {
    headers: { 'Content-Type': 'image/webp', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' },
  })
})
