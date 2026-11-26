import { requireStudyAccount } from '@/features/auth/server'
import { authorChatUnread, authorInbox, markAuthorChatRead, openAuthorChat, openAuthorContact, postAuthorChat, readAuthorChat, readOwnAuthorChat } from '@/server/author-chat'
import { scheduleChatReply } from '@/server/chat-ai'
import { parseBody, route, uuid } from '@/server/http'

export const GET = route(async (request: Request) => {
  const user = await requireStudyAccount(request)
  const params = new URL(request.url).searchParams
  if (params.has('thread')) return readAuthorChat(user, uuid(params.get('thread')), params)
  if (params.get('inbox') === '1') return authorInbox(user, params)
  if (params.get('mine') === '1') return readOwnAuthorChat(user)
  return authorChatUnread(user, params.get('withShared') === '1')
})

export const POST = route(async (request: Request) => {
  const user = await requireStudyAccount(request, true)
  const params = new URL(request.url).searchParams
  const threadId = params.get('thread')
  const contact = params.get('contact')
  if (threadId === null && contact !== null) return openAuthorContact(user, contact)
  if (threadId === null) return openAuthorChat(user)
  const thread = uuid(threadId)
  const sent = await postAuthorChat(user, thread, await parseBody(request, 4096))
  scheduleChatReply(user, sent.message, thread)
  return sent
})

export const PUT = route(async (request: Request) => {
  const user = await requireStudyAccount(request, true)
  const thread = uuid(new URL(request.url).searchParams.get('thread'))
  const body = await parseBody(request, 1024)
  return markAuthorChatRead(user, thread, body.through)
})
