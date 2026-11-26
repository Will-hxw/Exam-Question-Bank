import 'server-only'
import { createHash, createHmac } from 'node:crypto'
import { authorEmail, isSiteAuthor, type VerifiedUser } from '@/features/auth/server'
import { authorNickname, chatPageSize, messageLimit, nicknameLimit, publicAuthorNickname, type ChatAuthor, type ChatMessage, type ChatPage, type ChatProfile, type ChatRoom } from '@/features/chat/types'
import { publicAuthorAvatar } from '@/ui-images'
import { query } from './db'
import { HttpError, uuid } from './http'

const characters = ['奶龙', '奶娃', '噜噜']
const adjectives = [
  '困困的', '慢悠悠的', '有点皮的', '爱摸鱼的', '咕噜咕噜的', '不想起床的',
  '乐呵呵的', '圆滚滚的', '一脸疑惑的', '神采奕奕的', '爱吃橘子的', '假装淡定的',
  '软乎乎的', '得意洋洋的', '低调的', '认真的', '揣着奶茶的', '兴致勃勃的',
  '小声碎碎念的', '今天很乖的', '偷偷刷题的', '跑得飞快的', '爱晒太阳的', '攒了好运的',
  '嘴角上扬的', '脾气超好的', '还没睡醒的', '头顶冒泡的', '灵机一动的', '叼着饼干的',
  '心满意足的', '刚下课的', '元气满满的', '爱听八卦的', '正在思考的', '看热闹的',
]
export const chatProfileDefaults = { characters, adjectives, seedPrefix: 'eqb/chat-profile:', avatarsPerCharacter: 12 }

function chatAuthorKey(user: string) {
  const secret = process.env.NEON_AUTH_COOKIE_SECRET
  if (!secret) throw new Error('Missing chat identity secret')
  return createHmac('sha256', secret).update('eqb/chat-author:').update(user).digest('base64url')
}

type StoredAuthor = Omit<ChatAuthor, 'authorKey' | 'author'> & { authorUserId: string; author: boolean | null }
type StoredMessage = Omit<ChatMessage, 'authorKey' | 'author' | 'aiReplyTo' | 'avatarImageId' | 'avatarUrl'> & StoredAuthor & {
  avatarImageId: string | null
  aiReplyTo: string | null
}

export const authorIdSql = 'SELECT id::text FROM neon_auth."user" WHERE "emailVerified" AND email ='

function presentAuthor<T extends StoredAuthor>({ authorUserId, author, ...details }: T) {
  return { ...details, authorKey: chatAuthorKey(authorUserId),
    ...(author ? { author: true, nickname: publicAuthorNickname } : {}) }
}

function avatarImage(avatarImageId: string | null) {
  return avatarImageId ? { avatarImageId } : {}
}

function presentMessage({ avatarImageId, aiReplyTo, ...message }: StoredMessage): ChatMessage {
  const picture = message.author ? { avatarUrl: publicAuthorAvatar } : avatarImage(avatarImageId)
  return { ...presentAuthor(message), ...picture, ...(aiReplyTo ? { aiReplyTo } : {}) }
}

function defaultProfile(user: string): ChatProfile {
  // The assignment stays stable across devices without saving a profile on read.
  const { seedPrefix, avatarsPerCharacter } = chatProfileDefaults
  const seed = createHash('sha256').update(seedPrefix).update(user).digest()
  const avatar = seed.readUInt32BE(0) % (characters.length * avatarsPerCharacter)
  const character = characters[Math.floor(avatar / avatarsPerCharacter)]
  const adjective = adjectives[seed.readUInt32BE(4) % adjectives.length]
  return { authorKey: chatAuthorKey(user), nickname: adjective + character, avatar, nicknameRevision: '0' }
}

export function presentChatProfile(user: string, stored: {
  nickname?: string | null
  nicknameRevision?: string | null
  avatarImageId: string | null
}, author = false): ChatProfile {
  const profile = defaultProfile(user)
  return { ...profile, nickname: author ? authorNickname : stored.nickname ?? profile.nickname,
    nicknameRevision: stored.nicknameRevision ?? profile.nicknameRevision, ...avatarImage(stored.avatarImageId),
    ...(author ? { author: true } : {}) }
}

export function readChatText(value: unknown, limit: number, label: string, multiline: boolean) {
  const text = typeof value === 'string' ? value.replaceAll('\r\n', '\n').trim() : ''
  const controls = multiline ? /[\x00-\x08\x0b-\x1f\x7f\u202a-\u202e\u2066-\u2069\ud800-\udfff]/u
    : /[\x00-\x1f\x7f\u2028-\u202e\u2066-\u2069\ud800-\udfff]/u
  if (!text || text.length > limit || controls.test(text)) {
    throw new HttpError(400, `${label}需为 1 至 ${limit} 字的有效文本。`)
  }
  return text
}

export async function saveChatNickname(user: string, value: unknown): Promise<ChatProfile> {
  const nickname = readChatText(value, nicknameLimit, '昵称', false)
  if (/^(?:hua\s+xiaowei|(?:肥鱼\s*)?ai)(?:\s*\(|\s*$)/i.test(nickname.normalize('NFKC'))) {
    throw new HttpError(400, '这是作者的专用昵称，请换一个。')
  }
  await query('INSERT INTO profiles (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [user])
  // Serialize revision assignment so readers can safely advance their nickname cursor.
  const [{ nicknameRevision, avatarImageId }] = await query<{ nicknameRevision: string; avatarImageId: string | null }>(`
    WITH locked AS MATERIALIZED (SELECT pg_advisory_xact_lock(hashtext('eqb/chat-nicknames')))
    INSERT INTO chat_profiles (user_id, nickname, nickname_revision)
    SELECT $1, $2, nextval('chat_nickname_revision') FROM locked
    ON CONFLICT (user_id) DO UPDATE SET
      nickname = EXCLUDED.nickname, nickname_revision = EXCLUDED.nickname_revision
    RETURNING nickname_revision::text AS "nicknameRevision",
      (SELECT id FROM chat_avatars WHERE user_id = $1) AS "avatarImageId"
  `, [user, nickname])
  return presentChatProfile(user, { nickname, nicknameRevision, avatarImageId })
}

const messageFields = `m.id::text AS id, m.user_id AS "authorUserId", COALESCE(p.nickname, m.nickname) AS nickname,
  COALESCE(p.nickname_revision, 0)::text AS "nicknameRevision", m.avatar, a.id AS "avatarImageId", m.body,
  m.sent_at AS "sentAt", (m.user_id = $1) AS mine, m.ai_reply_to::text AS "aiReplyTo"`

export function validChatCursor(value: string) {
  return /^(?:0|[1-9][0-9]{0,18})$/.test(value) && BigInt(value) <= 9223372036854775807n
}

function unreadAfter(cursor: string) {
  return `EXISTS (SELECT 1 FROM chat_messages WHERE id > ${cursor} AND user_id <> $1)`
}

export const sharedChatUnreadSql = unreadAfter('coalesce((SELECT last_read_id FROM chat_reads WHERE user_id = $1), 0)')

export async function markSharedChatRead(userId: string, through: unknown) {
  if (typeof through !== 'string' || through === '0' || !validChatCursor(through)) {
    throw new HttpError(400, '消息位置无效。')
  }
  const [result] = await query<{ unread: boolean }>(`
    WITH viewed AS (SELECT id FROM chat_messages WHERE id = $2 AND user_id <> $1),
    profile AS (INSERT INTO profiles (user_id) SELECT $1 FROM viewed ON CONFLICT DO NOTHING),
    read_chat AS (
      INSERT INTO chat_reads (user_id, last_read_id) SELECT $1, id FROM viewed
      ON CONFLICT (user_id) DO UPDATE SET last_read_id = greatest(chat_reads.last_read_id, EXCLUDED.last_read_id)
      RETURNING last_read_id
    )
    SELECT ${unreadAfter('last_read_id')} AS unread FROM read_chat
  `, [userId, through])
  if (!result) throw new HttpError(404, '消息不存在。')
  return result
}

export async function chatRoom(user: VerifiedUser): Promise<ChatRoom> {
  // The initial cursor and all visible names come from the same database snapshot.
  const [room] = await query<{
    messages: StoredMessage[]
    nickname: string | null
    nicknameRevision: string | null
    avatarImageId: string | null
    nicknameCursor: string
  }>(`
    WITH author_account AS (${authorIdSql} $2), recent AS (
      SELECT ${messageFields}, (m.user_id = (SELECT id FROM author_account)) AS author
      FROM chat_messages m
      LEFT JOIN chat_profiles p ON p.user_id = m.user_id
      LEFT JOIN chat_avatars a ON a.user_id = m.user_id
      ORDER BY m.id DESC LIMIT ${chatPageSize + 1}
    )
    SELECT (SELECT coalesce(jsonb_agg(recent ORDER BY recent.id::bigint DESC), '[]') FROM recent) AS messages,
      p.nickname, p.nickname_revision::text AS "nicknameRevision", a.id AS "avatarImageId",
      (SELECT COALESCE(max(nickname_revision), 0)::text
        FROM chat_profiles WHERE nickname_revision > 0) AS "nicknameCursor"
    FROM (SELECT $1::text AS id) viewer
    LEFT JOIN chat_profiles p ON p.user_id = viewer.id
    LEFT JOIN chat_avatars a ON a.user_id = viewer.id
  `, [user.id, authorEmail])
  const messages = room.messages.slice(0, chatPageSize).reverse().map((message) => (
    presentMessage({ ...message, sentAt: new Date(message.sentAt).toISOString() })
  ))
  const author = isSiteAuthor(user)
  const profile = presentChatProfile(user.id, { ...room, avatarImageId: author ? null : room.avatarImageId }, author)
  return {
    messages, hasMore: room.messages.length > chatPageSize,
    profile: author ? { ...profile, nickname: publicAuthorNickname, avatarUrl: publicAuthorAvatar } : profile,
    nicknameCursor: room.nicknameCursor,
  }
}

export async function chatNicknameUpdates(user: string, cursors: string[]) {
  if (cursors.length !== 1 || !validChatCursor(cursors[0])) throw new HttpError(400, '昵称同步位置无效。')
  const rows = await query<StoredAuthor>(`
    SELECT user_id AS "authorUserId", nickname, nickname_revision::text AS "nicknameRevision",
      (user_id = (${authorIdSql} $3)) AS author
    FROM chat_profiles
    WHERE nickname_revision > 0 AND nickname_revision > $1
      AND (user_id = $2 OR EXISTS (SELECT 1 FROM chat_messages m WHERE m.user_id = chat_profiles.user_id))
    ORDER BY nickname_revision
    LIMIT ${chatPageSize + 1}
  `, [cursors[0], user, authorEmail])
  return { nicknames: rows.slice(0, chatPageSize).map(presentAuthor), hasMoreNicknames: rows.length > chatPageSize }
}

export function chatCursor(params: URLSearchParams) {
  const cursors = [...params.getAll('before'), ...params.getAll('after')]
  const cursor = cursors[0]
  const forward = params.has('after')
  if (cursors.length > 1 || (cursor !== undefined && (!validChatCursor(cursor) || (!forward && cursor === '0')))) {
    throw new HttpError(400, '消息位置无效。')
  }
  return { cursor, forward }
}

export async function chatMessages(user: string, params: URLSearchParams): Promise<ChatPage> {
  const { cursor, forward } = chatCursor(params)
  const rows = await query<StoredMessage>(`
    SELECT ${messageFields}, (m.user_id = (${authorIdSql} $2)) AS author FROM chat_messages m
    LEFT JOIN chat_profiles p ON p.user_id = m.user_id
    LEFT JOIN chat_avatars a ON a.user_id = m.user_id
    ${cursor ? `WHERE m.id ${forward ? '>' : '<'} $3` : ''}
    ORDER BY m.id ${forward ? 'ASC' : 'DESC'}
    LIMIT ${chatPageSize + 1}
  `, cursor ? [user, authorEmail, cursor] : [user, authorEmail])
  const messages = rows.slice(0, chatPageSize).map(presentMessage)
  if (!forward) messages.reverse()
  return { messages, hasMore: rows.length > chatPageSize }
}

export async function postChatMessage(user: VerifiedUser, body: Record<string, unknown>) {
  const clientId = uuid(body.clientId)
  const content = readChatText(body.message, messageLimit, '消息', true)
  const profile = defaultProfile(user.id)
  const [message] = await query<StoredMessage>(`
    SELECT ${messageFields}, $6::boolean AS author
    FROM send_chat_message($1, $2, $3, $4, $5::smallint) m
    LEFT JOIN chat_profiles p ON p.user_id = m.user_id
    LEFT JOIN chat_avatars a ON a.user_id = m.user_id
    WHERE m.id IS NOT NULL
  `, [user.id, clientId, content, profile.nickname, profile.avatar, isSiteAuthor(user)])
  if (!message) throw new HttpError(429, '发得太快了，请稍后再试。')
  if (message.body !== content) throw new HttpError(409, '这条消息已发送，请重新输入。')
  return { message: presentMessage(message) }
}
