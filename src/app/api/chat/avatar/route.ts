import { authorEmail, isSiteAuthor, requireStudyAccount } from '@/features/auth/server'
import { authorIdSql } from '@/server/chat'
import { query } from '@/server/db'
import { HttpError, route, uuid } from '@/server/http'

export const GET = route(async (request: Request) => {
  const user = await requireStudyAccount(request)
  const id = uuid(new URL(request.url).searchParams.get('id'))
  const [avatar] = await query<{ image: string }>(`
    WITH owner_account AS (${authorIdSql} $4)
    SELECT encode(a.image, 'base64') AS image
    FROM chat_avatars a
    WHERE a.id = $1 AND (
      a.user_id = $2 OR (a.user_id IS DISTINCT FROM (SELECT id FROM owner_account)
        AND EXISTS (SELECT 1 FROM chat_messages m WHERE m.user_id = a.user_id))
      OR ($3::boolean AND EXISTS (SELECT 1 FROM author_conversations c WHERE c.user_id = a.user_id))
      OR (a.user_id = (SELECT id FROM owner_account) AND EXISTS (SELECT 1 FROM author_conversations c WHERE c.user_id = $2))
    )
  `, [id, user.id, isSiteAuthor(user), authorEmail])
  if (!avatar) throw new HttpError(404, '头像不存在。')
  return new Response(Uint8Array.from(Buffer.from(avatar.image, 'base64')), {
    headers: { 'Content-Type': 'image/webp', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' },
  })
})
