import 'server-only'
import { createHash, createHmac } from 'node:crypto'
import { messageLimit, nicknameLimit, type ChatAuthor, type ChatMessage, type ChatPage, type ChatProfile, type ChatRoom } from '@/features/chat/types'
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

function chatAuthorKey(user: string) {
  const secret = process.env.NEON_AUTH_COOKIE_SECRET
  if (!secret) throw new Error('Missing chat identity secret')
  return createHmac('sha256', secret).update('eqb/chat-author:').update(user).digest('base64url')
}

type StoredAuthor = Omit<ChatAuthor, 'authorKey'> & { authorUserId: string }
type StoredMessage = Omit<ChatMessage, 'authorKey'> & StoredAuthor

function presentAuthor<T extends StoredAuthor>({ authorUserId, ...details }: T) {
  return { ...details, authorKey: chatAuthorKey(authorUserId) }
}

function defaultProfile(user: string): ChatProfile {
  // The assignment stays stable across devices without saving a profile on read.
  const seed = createHash('sha256').update('eqb/chat-profile:').update(user).digest()
  const avatar = seed.readUInt32BE(0) % 36
  const character = characters[Math.floor(avatar / 12)]
  const adjective = adjectives[seed.readUInt32BE(4) % adjectives.length]
  return { authorKey: chatAuthorKey(user), nickname: adjective + character, avatar, nicknameRevision: '0' }
}

function readText(value: unknown, limit: number, label: string, multiline: boolean) {
  const text = typeof value === 'string' ? value.replaceAll('\r\n', '\n').trim() : ''
  const controls = multiline ? /[\x00-\x08\x0b-\x1f\x7f\u202a-\u202e\u2066-\u2069\ud800-\udfff]/u
    : /[\x00-\x1f\x7f\u2028-\u202e\u2066-\u2069\ud800-\udfff]/u
  if (!text || text.length > limit || controls.test(text)) {
    throw new HttpError(400, `${label}需为 1 至 ${limit} 字的有效文本。`)
  }
  return text
}

export async function saveChatNickname(user: string, value: unknown): Promise<ChatProfile> {
  const nickname = readText(value, nicknameLimit, '昵称', false)
  await query('INSERT INTO profiles (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [user])
  // Serialize revision assignment so readers can safely advance their nickname cursor.
  const [{ nicknameRevision }] = await query<{ nicknameRevision: string }>(`
    WITH locked AS MATERIALIZED (SELECT pg_advisory_xact_lock(hashtext('eqb/chat-nicknames')))
    INSERT INTO chat_profiles (user_id, nickname, nickname_revision)
    SELECT $1, $2, nextval('chat_nickname_revision') FROM locked
    ON CONFLICT (user_id) DO UPDATE SET
      nickname = EXCLUDED.nickname, nickname_revision = EXCLUDED.nickname_revision
    RETURNING nickname_revision::text AS "nicknameRevision"
  `, [user, nickname])
  return { ...defaultProfile(user), nickname, nicknameRevision }
}

const messageFields = `m.id::text AS id, m.user_id AS "authorUserId", COALESCE(p.nickname, m.nickname) AS nickname,
  COALESCE(p.nickname_revision, 0)::text AS "nicknameRevision", m.avatar, m.body,
  m.sent_at AS "sentAt", (m.user_id = $1) AS mine`
const pageSize = 40

function validCursor(value: string) {
  return /^(?:0|[1-9][0-9]{0,18})$/.test(value) && BigInt(value) <= 9223372036854775807n
}

export async function chatRoom(user: string): Promise<ChatRoom> {
  // The initial cursor and all visible names come from the same database snapshot.
  const [room] = await query<{
    messages: StoredMessage[]
    custom: Pick<ChatAuthor, 'nickname' | 'nicknameRevision'> | null
    nicknameCursor: string
  }>(`
    SELECT (SELECT COALESCE(jsonb_agg(recent ORDER BY recent.id::bigint DESC), '[]'::jsonb)
      FROM (
        SELECT ${messageFields} FROM chat_messages m
        LEFT JOIN chat_profiles p ON p.user_id = m.user_id
        ORDER BY m.id DESC LIMIT ${pageSize + 1}
      ) recent) AS messages,
      (SELECT jsonb_build_object('nickname', nickname, 'nicknameRevision', nickname_revision::text)
        FROM chat_profiles WHERE user_id = $1) AS custom,
      (SELECT COALESCE(max(nickname_revision), 0)::text
        FROM chat_profiles WHERE nickname_revision > 0) AS "nicknameCursor"
  `, [user])
  const messages = room.messages.slice(0, pageSize).reverse().map((message) => (
    presentAuthor({ ...message, sentAt: new Date(message.sentAt).toISOString() })
  ))
  return {
    messages, hasMore: room.messages.length > pageSize,
    profile: { ...defaultProfile(user), ...room.custom }, nicknameCursor: room.nicknameCursor,
  }
}

export async function chatNicknameUpdates(user: string, cursors: string[]) {
  if (cursors.length !== 1 || !validCursor(cursors[0])) throw new HttpError(400, '昵称同步位置无效。')
  const rows = await query<StoredAuthor>(`
    SELECT user_id AS "authorUserId", nickname, nickname_revision::text AS "nicknameRevision"
    FROM chat_profiles
    WHERE nickname_revision > 0 AND nickname_revision > $1
      AND (user_id = $2 OR EXISTS (SELECT 1 FROM chat_messages m WHERE m.user_id = chat_profiles.user_id))
    ORDER BY nickname_revision
    LIMIT ${pageSize + 1}
  `, [cursors[0], user])
  return { nicknames: rows.slice(0, pageSize).map(presentAuthor), hasMoreNicknames: rows.length > pageSize }
}

export async function chatMessages(user: string, params: URLSearchParams): Promise<ChatPage> {
  const cursors = [...params.getAll('before'), ...params.getAll('after')]
  const cursor = cursors[0]
  const forward = params.has('after')
  if (cursors.length > 1 || (cursor !== undefined && (!validCursor(cursor) || (!forward && cursor === '0')))) {
    throw new HttpError(400, '消息位置无效。')
  }
  const rows = await query<StoredMessage>(`
    SELECT ${messageFields} FROM chat_messages m
    LEFT JOIN chat_profiles p ON p.user_id = m.user_id
    ${cursor ? `WHERE m.id ${forward ? '>' : '<'} $2` : ''}
    ORDER BY m.id ${forward ? 'ASC' : 'DESC'}
    LIMIT ${pageSize + 1}
  `, cursor ? [user, cursor] : [user])
  const messages = rows.slice(0, pageSize).map(presentAuthor)
  if (!forward) messages.reverse()
  return { messages, hasMore: rows.length > pageSize }
}

export async function postChatMessage(user: string, body: Record<string, unknown>) {
  const clientId = uuid(body.clientId)
  const content = readText(body.message, messageLimit, '消息', true)
  const profile = defaultProfile(user)
  const [message] = await query<StoredMessage>(`
    SELECT ${messageFields}
    FROM send_chat_message($1, $2, $3, $4, $5::smallint) m
    LEFT JOIN chat_profiles p ON p.user_id = m.user_id
    WHERE m.id IS NOT NULL
  `, [user, clientId, content, profile.nickname, profile.avatar])
  if (!message) throw new HttpError(429, '发得太快了，请稍后再试。')
  if (message.body !== content) throw new HttpError(409, '这条消息已发送，请重新输入。')
  return { message: presentAuthor(message) }
}
