import 'server-only'
import { createHash } from 'node:crypto'
import { messageLimit, nicknameLimit, type ChatMessage, type ChatPage, type ChatProfile } from '@/features/chat/types'
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

function defaultProfile(user: string): ChatProfile {
  // The assignment stays stable across devices without saving a profile on read.
  const seed = createHash('sha256').update('eqb/chat-profile:').update(user).digest()
  const avatar = seed.readUInt32BE(0) % 36
  const character = characters[Math.floor(avatar / 12)]
  const adjective = adjectives[seed.readUInt32BE(4) % adjectives.length]
  return { nickname: adjective + character, avatar }
}

export async function chatProfile(user: string) {
  const profile = defaultProfile(user)
  const [custom] = await query<{ nickname: string }>('SELECT nickname FROM chat_profiles WHERE user_id = $1', [user])
  return custom ? { ...profile, nickname: custom.nickname } : profile
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
  await query(`
    INSERT INTO chat_profiles (user_id, nickname) VALUES ($1, $2)
    ON CONFLICT (user_id) DO UPDATE SET nickname = EXCLUDED.nickname
  `, [user, nickname])
  return { ...defaultProfile(user), nickname }
}

const messageFields = `m.id::text AS id, m.nickname, m.avatar, m.body,
  m.sent_at AS "sentAt", (m.user_id = $1) AS mine`
const pageSize = 40

export async function chatMessages(user: string, params: URLSearchParams): Promise<ChatPage> {
  const cursors = [...params.getAll('before'), ...params.getAll('after')]
  const cursor = cursors[0]
  const forward = params.has('after')
  if (cursors.length > 1 || (cursor !== undefined && !(forward && cursor === '0')
    && (!/^[1-9][0-9]{0,18}$/.test(cursor) || BigInt(cursor) > 9223372036854775807n))) {
    throw new HttpError(400, '消息位置无效。')
  }
  const rows = await query<ChatMessage>(`
    SELECT ${messageFields} FROM chat_messages m
    ${cursor ? `WHERE m.id ${forward ? '>' : '<'} $2` : ''}
    ORDER BY m.id ${forward ? 'ASC' : 'DESC'}
    LIMIT ${pageSize + 1}
  `, cursor ? [user, cursor] : [user])
  const messages = rows.slice(0, pageSize)
  if (!forward) messages.reverse()
  return { messages, hasMore: rows.length > pageSize }
}

export async function postChatMessage(user: string, body: Record<string, unknown>) {
  const clientId = uuid(body.clientId)
  const content = readText(body.message, messageLimit, '消息', true)
  const profile = defaultProfile(user)
  const [message] = await query<ChatMessage>(`
    SELECT ${messageFields}
    FROM send_chat_message($1, $2, $3, $4, $5::smallint) m
    WHERE m.id IS NOT NULL
  `, [user, clientId, content, profile.nickname, profile.avatar])
  if (!message) throw new HttpError(429, '发得太快了，请稍后再试。')
  if (message.body !== content) throw new HttpError(409, '这条消息已发送，请重新输入。')
  return { message }
}
