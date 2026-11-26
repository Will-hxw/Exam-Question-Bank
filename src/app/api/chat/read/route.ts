import { requireStudyAccount } from '@/features/auth/server'
import { markSharedChatRead } from '@/server/chat'
import { parseBody, route } from '@/server/http'

export const PUT = route(async (request: Request) => {
  const user = await requireStudyAccount(request, true)
  const body = await parseBody(request, 1024)
  return markSharedChatRead(user.id, body.through)
})
