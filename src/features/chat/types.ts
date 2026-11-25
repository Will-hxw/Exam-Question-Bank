export const nicknameLimit = 24
export const messageLimit = 500

export type ChatAuthor = {
  authorKey: string
  nickname: string
  nicknameRevision: string
}
export type ChatProfile = ChatAuthor & { avatar: number; avatarImageId?: string }
export type ChatMessage = ChatProfile & {
  id: string
  body: string
  sentAt: string
  mine: boolean
}
export type ChatPage = { messages: ChatMessage[]; hasMore: boolean }
export type ChatRoom = ChatPage & { profile: ChatProfile; nicknameCursor: string }
export type ChatUpdates = ChatPage & { nicknames: ChatAuthor[]; hasMoreNicknames: boolean }
