export const nicknameLimit = 48
export const messageLimit = 500
export const chatPageSize = 40
export const authorNickname = 'Hua Xiaowei'
const publicAuthorName = 'AI'
export const publicAuthorNickname = `${publicAuthorName}（可@）`
export const publicAuthorMention = `@${publicAuthorName}`
export const authorMention = `@${authorNickname}`
export const authorChatHash = '#author-chat'
export const authorChatPath = '/api/author-chat'
export const unreadDescriptionId = 'author-chat-unread-description'

export type ChatAuthor = {
  authorKey: string
  nickname: string
  nicknameRevision: string
  author?: boolean
}
export type ChatProfile = ChatAuthor & { avatar: number; avatarImageId?: string; avatarUrl?: string }
export type ChatMessage = ChatProfile & {
  id: string
  body: string
  sentAt: string
  mine: boolean
  clientId?: string
  aiReplyTo?: string
}
export type ChatPage = { messages: ChatMessage[]; hasMore: boolean }
export type ChatRoom = ChatPage & { profile: ChatProfile; nicknameCursor: string; authorAvatar?: string }
export type ChatUpdates = ChatPage & { nicknames: ChatAuthor[]; hasMoreNicknames: boolean }

export type AuthorChatPeer = ChatProfile & { email?: string }
export type AuthorChatRoom = ChatRoom & { conversationId: string; peer: AuthorChatPeer }
export type AuthorConversation = {
  id: string | null
  userId: string
  peer: AuthorChatPeer
  preview: string | null
  sentAt: string | null
  unread: boolean
  mine: boolean
}
export type AuthorInbox = { conversations: AuthorConversation[]; nextCursor: string | null }
