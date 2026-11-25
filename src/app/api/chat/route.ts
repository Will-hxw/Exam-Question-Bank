import { chatMessages, chatProfile, postChatMessage, saveChatNickname } from '@/server/chat'
import { parseBody, route } from '@/server/http'
import { account } from '@/server/learning'

export const GET = route(async (request: Request) => {
  const user = await account(request)
  const params = new URL(request.url).searchParams
  if (params.has('before') || params.has('after')) return chatMessages(user, params)
  const [page, profile] = await Promise.all([chatMessages(user, params), chatProfile(user)])
  return { ...page, profile }
})

export const POST = route(async (request: Request) => {
  const user = await account(request, true)
  return postChatMessage(user, await parseBody(request, 4096))
})

export const PUT = route(async (request: Request) => {
  const user = await account(request, true)
  const body = await parseBody(request, 512)
  return { profile: await saveChatNickname(user, body.nickname) }
})
