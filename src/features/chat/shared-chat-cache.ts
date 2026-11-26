import { requestJson } from '@/features/study/api'
import { chatPageSize, type ChatAuthor, type ChatRoom, type ChatUpdates } from './types'

export const sharedChatPath = '/api/chat'
const maxAge = 30_000
let sharedRoom: { userId: string; expiresAt: number; pending: Promise<ChatRoom>; data?: ChatRoom } | undefined

export function currentSharedRoom(userId: string) {
  return sharedRoom?.userId === userId && sharedRoom.expiresAt > Date.now() ? sharedRoom : undefined
}

export function warmSharedChat(userId: string) {
  const warmed = currentSharedRoom(userId)
  if (warmed) return warmed.pending
  const entry: NonNullable<typeof sharedRoom> = {
    userId, expiresAt: Date.now() + maxAge,
    pending: requestJson<ChatRoom>(sharedChatPath, { headers: { 'X-Study-Account': userId } }).then((room) => {
      entry.data = room
      return room
    }).catch((error: unknown) => {
      if (sharedRoom === entry) sharedRoom = undefined
      throw error
    }),
  }
  sharedRoom = entry
  return entry.pending
}

export function refreshSharedChatSnapshot(userId: string, page: ChatUpdates) {
  const entry = sharedRoom
  if (!entry?.data || entry.userId !== userId) return
  entry.expiresAt = Date.now() + maxAge
  if (!page.messages.length && !page.nicknames.length) return
  const recent = new Map(entry.data.messages.map((message) => [message.id, message]))
  for (const message of page.messages) recent.set(message.id, message)
  const nicknames = new Map(page.nicknames.map((author) => [author.authorKey, author]))
  function update<T extends ChatAuthor>(original: T): T {
    const latest = nicknames.get(original.authorKey)
    return latest && BigInt(latest.nicknameRevision) > BigInt(original.nicknameRevision) ? { ...original, ...latest } : original
  }
  const messages = [...recent.values()].sort((left, right) => BigInt(left.id) < BigInt(right.id) ? -1 : 1)
  entry.data = {
    ...entry.data, messages: messages.slice(-chatPageSize).map(update), hasMore: entry.data.hasMore || messages.length > chatPageSize,
    profile: update(entry.data.profile), nicknameCursor: page.nicknames.at(-1)?.nicknameRevision ?? entry.data.nicknameCursor,
  }
  entry.pending = Promise.resolve(entry.data)
}
