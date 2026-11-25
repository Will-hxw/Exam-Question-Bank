export const nicknameLimit = 24
export const messageLimit = 500

export type ChatProfile = { nickname: string; avatar: number }
export type ChatMessage = ChatProfile & {
  id: string
  body: string
  sentAt: string
  mine: boolean
}
export type ChatPage = { messages: ChatMessage[]; hasMore: boolean }
export type ChatRoom = ChatPage & { profile: ChatProfile }
