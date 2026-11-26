import { isSiteAuthor, requireStudyAccount } from '@/features/auth/server'
import { chatMessages, chatNicknameUpdates, chatRoom, postChatMessage, saveChatNickname } from '@/server/chat'
import { scheduleChatReply } from '@/server/chat-ai'
import { HttpError, parseBody, route } from '@/server/http'

export const GET = route(async (request: Request) => {
  const user = await requireStudyAccount(request)
  const params = new URL(request.url).searchParams
  if (params.has('nicknamesAfter')) {
    const [page, updates] = await Promise.all([chatMessages(user.id, params), chatNicknameUpdates(user.id, params.getAll('nicknamesAfter'))])
    return { ...page, ...updates }
  }
  if (params.has('before') || params.has('after')) return chatMessages(user.id, params)
  return chatRoom(user)
})

export const POST = route(async (request: Request) => {
  const user = await requireStudyAccount(request, true)
  const sent = await postChatMessage(user, await parseBody(request, 4096))
  scheduleChatReply(user, sent.message)
  return sent
})

export const PUT = route(async (request: Request) => {
  const user = await requireStudyAccount(request, true)
  if (isSiteAuthor(user)) throw new HttpError(403, '作者昵称由站点统一设置。')
  const body = await parseBody(request, 1024)
  return { profile: await saveChatNickname(user.id, body.nickname) }
})
