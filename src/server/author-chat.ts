import 'server-only'
import { authorEmail, isSiteAuthor, type VerifiedUser } from '@/features/auth/server'
import { chatPageSize, messageLimit, type AuthorChatRoom, type AuthorConversation, type AuthorInbox, type ChatMessage, type ChatPage } from '@/features/chat/types'
import { authorIdSql, chatCursor, chatProfileDefaults, presentChatProfile, readChatText, sharedChatUnreadSql, validChatCursor } from './chat'
import { query } from './db'
import { HttpError, uuid } from './http'

const authorGreeting = '你好，感谢使用，欢迎分享，请问有什么问题吗？'
const inboxPageSize = 30
const threadMissing = '会话不存在。'
const contactIdPattern = /^[\da-zA-Z_-]{1,128}$/
type StoredProfile = { nickname: string | null; nicknameRevision: string | null; avatarImageId: string | null }
type StoredMessage = { id: string; body: string; sentAt: string; fromAuthor: boolean; aiReplyTo: string | null; clientId: string | null }
type StoredThread = {
  userId: string
  email: string
  authorId: string
  authorProfile: StoredProfile
  userProfile: StoredProfile
  authorAvatar: string | null
  messages: StoredMessage[]
}

const messageFields = `m.id::text AS id, m.body, m.sent_at AS "sentAt", m.from_author AS "fromAuthor",
  m.ai_reply_to::text AS "aiReplyTo", CASE WHEN m.from_author = $3 THEN m.client_id::text END AS "clientId"`
const profileJson = (profile: string, avatar: string) => `jsonb_build_object(
  'nickname', ${profile}.nickname, 'nicknameRevision', ${profile}.nickname_revision::text, 'avatarImageId', ${avatar}.id
)`

function threadPage(row: StoredThread, author: boolean, forward: boolean): ChatPage {
  const authorProfile = presentChatProfile(row.authorId, row.authorProfile, true)
  const userProfile = presentChatProfile(row.userId, row.userProfile)
  const page = row.messages.slice(0, chatPageSize)
  if (!forward) page.reverse()
  return { hasMore: row.messages.length > chatPageSize, messages: page.map(({ fromAuthor, aiReplyTo, clientId, ...message }) => ({
    ...(fromAuthor ? authorProfile : userProfile), ...message,
    sentAt: new Date(message.sentAt).toISOString(), mine: fromAuthor === author,
    ...(aiReplyTo ? { aiReplyTo } : {}),
    ...(clientId ? { clientId } : {}),
  })) }
}

export async function authorChatUnread(user: VerifiedUser, withShared = false) {
  const author = isSiteAuthor(user)
  const [result] = await query<{ unread: boolean; sharedUnread?: boolean }>(`
    SELECT EXISTS (SELECT 1 FROM author_conversations WHERE
      ${author ? 'last_user_id > author_read_id' : 'user_id = $1 AND last_author_id > user_read_id'}
    ) AS unread ${withShared ? `, ${sharedChatUnreadSql} AS "sharedUnread"` : ''}
  `, !author || withShared ? [user.id] : [])
  return result
}

function inboxCursor(value: string | null) {
  if (value === null) return { last: null, contact: null }
  const [last, contact, extra] = value.split(':')
  if (!validChatCursor(last) || extra !== undefined || (contact === undefined ? last === '0' : !contactIdPattern.test(contact))) {
    throw new HttpError(400, '会话位置无效。')
  }
  return { last, contact: contact ?? null }
}

function unsignedWord(start: number) {
  // PostgreSQL scans the same big-endian SHA-256 bytes as defaultProfile.
  return `(${[24, 16, 8, 0].map((shift, offset) => `(get_byte(seed, ${start + offset})::bigint << ${shift})`).join(' | ')})`
}

export async function authorInbox(user: VerifiedUser, params: URLSearchParams): Promise<AuthorInbox> {
  if (!isSiteAuthor(user)) throw new HttpError(403, '仅作者可以查看会话列表。')
  const { last, contact } = inboxCursor(params.get('before'))
  const search = params.get('q')?.trim() ?? ''
  if (search.length > 100 || search.includes('\x00')) throw new HttpError(400, '搜索词无效。')
  const unreadOnly = params.get('unread') === '1'
  const directory = params.get('directory') === '1'
  const { characters, adjectives, avatarsPerCharacter, seedPrefix } = chatProfileDefaults
  const lastId = 'coalesce(c.last_message_id, 0)'
  const defaultNickname = `($6::text[])[(${unsignedWord(4)} % ${adjectives.length})::int + 1]
    || ($5::text[])[((${unsignedWord(0)} % ${characters.length * avatarsPerCharacter}) / ${avatarsPerCharacter})::int + 1]`
  const rows = await query<StoredProfile & Omit<AuthorConversation, 'peer'> & { email: string; cursor: string }>(`
    SELECT c.id, u.id::text AS "userId", u.email, p.nickname, p.nickname_revision::text AS "nicknameRevision",
      a.id AS "avatarImageId", m.body AS preview, m.sent_at AS "sentAt", coalesce(m.from_author, false) AS mine,
      coalesce(c.last_user_id > c.author_read_id, false) AS unread, (${lastId})::text AS cursor
    FROM neon_auth."user" u
    LEFT JOIN author_conversations c ON c.user_id = u.id::text
    LEFT JOIN author_messages m ON m.id = c.last_message_id
    LEFT JOIN chat_profiles p ON p.user_id = u.id::text
    LEFT JOIN chat_avatars a ON a.user_id = u.id::text
    CROSS JOIN LATERAL (SELECT sha256(convert_to($7::text || u.id::text, 'UTF8')) AS seed) hashed
    WHERE u.id::text <> $4
      AND ($2::bigint IS NULL OR ${lastId} < $2 OR (${lastId} = $2 AND u.id::text > $3::text))
      AND ($1::text = '' OR strpos(lower(u.email), lower($1)) > 0
        OR strpos(lower(coalesce(p.nickname, c.default_nickname, ${defaultNickname})), lower($1)) > 0)
      ${directory ? '' : 'AND u."emailVerified" AND m.id IS NOT NULL'}
      ${unreadOnly ? 'AND c.last_user_id > c.author_read_id' : ''}
    ORDER BY ${lastId} DESC, u.id::text ASC LIMIT ${inboxPageSize + 1}
  `, [search, last, contact, user.id, characters, adjectives, seedPrefix])
  const tail = rows.length > inboxPageSize ? rows[inboxPageSize - 1] : null
  return {
    conversations: rows.slice(0, inboxPageSize).map((row) => ({
      id: row.id, userId: row.userId, peer: { ...presentChatProfile(row.userId, row), email: row.email },
      preview: row.preview, sentAt: row.sentAt, unread: row.unread, mine: row.mine,
    })),
    nextCursor: tail ? (directory ? `${tail.cursor}:${tail.userId}` : tail.cursor) : null,
  }
}

export async function readAuthorChat(user: VerifiedUser, thread: string, params = new URLSearchParams()): Promise<AuthorChatRoom> {
  const author = isSiteAuthor(user)
  const { cursor, forward } = chatCursor(params)
  const [row] = await query<StoredThread>(`
    WITH author_account AS (${authorIdSql} $1)
    SELECT c.user_id AS "userId", u.email, owner.id AS "authorId",
      ${profileJson('ap', 'aa')} AS "authorProfile", ${profileJson('p', 'a')} AS "userProfile",
      ${cursor ? 'NULL' : "encode(aa.image, 'base64')"} AS "authorAvatar",
      (SELECT coalesce(jsonb_agg(recent ORDER BY recent.id::bigint ${forward ? 'ASC' : 'DESC'}), '[]')
        FROM (SELECT ${messageFields} FROM author_messages m
          WHERE m.conversation_id = c.id ${cursor ? `AND m.id ${forward ? '>' : '<'} $5` : ''}
          ORDER BY m.id ${forward ? 'ASC' : 'DESC'} LIMIT ${chatPageSize + 1}
        ) recent) AS messages
    FROM author_conversations c
    CROSS JOIN author_account owner
    JOIN neon_auth."user" u ON u.id::text = c.user_id
    LEFT JOIN chat_profiles p ON p.user_id = c.user_id
    LEFT JOIN chat_avatars a ON a.user_id = c.user_id
    LEFT JOIN chat_profiles ap ON ap.user_id = owner.id
    LEFT JOIN chat_avatars aa ON aa.user_id = owner.id
    WHERE c.id = $2 AND ($3::boolean OR c.user_id = $4)
  `, cursor ? [authorEmail, thread, author, user.id, cursor] : [authorEmail, thread, author, user.id])
  if (!row) throw new HttpError(404, threadMissing)
  const owner = presentChatProfile(row.authorId, row.authorProfile, true)
  const student = presentChatProfile(row.userId, row.userProfile)
  return { ...threadPage(row, author, forward), conversationId: thread, nicknameCursor: '0',
    profile: author ? owner : student, peer: author ? { ...student, email: row.email } : owner,
    ...(row.authorAvatar ? { authorAvatar: row.authorAvatar } : {}),
  }
}

export async function openAuthorChat(user: VerifiedUser) {
  if (isSiteAuthor(user)) throw new HttpError(403, '请从会话列表选择一位同学。')
  const nickname = presentChatProfile(user.id, { avatarImageId: null }).nickname
  const [room] = await query<{ id: string }>(`
    SELECT open_author_chat($1, $2, $3) AS id WHERE EXISTS (${authorIdSql} $4)
  `, [user.id, authorGreeting, nickname, authorEmail])
  if (!room) throw new HttpError(503, '作者对话暂不可用，请稍后再试。')
  return readAuthorChat(user, room.id)
}

export async function openAuthorContact(user: VerifiedUser, contact: string) {
  if (!isSiteAuthor(user)) throw new HttpError(403, '仅作者可以选择联系人。')
  if (!contactIdPattern.test(contact) || contact === user.id) throw new HttpError(400, '联系人无效。')
  const nickname = presentChatProfile(contact, { avatarImageId: null }).nickname
  const [room] = await query<{ id: string }>(`
    SELECT open_author_chat(u.id::text, NULL, $2) AS id
    FROM neon_auth."user" u WHERE u.id::text = $1
  `, [contact, nickname])
  if (!room) throw new HttpError(404, '联系人不存在。')
  return readAuthorChat(user, room.id)
}

export async function readOwnAuthorChat(user: VerifiedUser) {
  if (isSiteAuthor(user)) throw new HttpError(403, '请从会话列表选择一位同学。')
  const [room] = await query<{ id: string }>('SELECT id FROM author_conversations WHERE user_id = $1', [user.id])
  if (!room) throw new HttpError(404, '请从意见反馈打开作者对话。')
  return readAuthorChat(user, room.id)
}

export async function postAuthorChat(user: VerifiedUser, thread: string, body: Record<string, unknown>) {
  const content = readChatText(body.message, messageLimit, '消息', true)
  const clientId = uuid(body.clientId)
  const author = isSiteAuthor(user)
  const [row] = await query<StoredProfile & { id: string | null; body: string; sentAt: string }>(`
    SELECT m.id::text, m.body, m.sent_at AS "sentAt",
      p.nickname, p.nickname_revision::text AS "nicknameRevision", a.id AS "avatarImageId"
    FROM author_conversations c
    CROSS JOIN LATERAL send_author_message(c.id, $2, $3, $4, $5) m
    LEFT JOIN chat_profiles p ON p.user_id = $2
    LEFT JOIN chat_avatars a ON a.user_id = $2
    WHERE c.id = $1 AND ($3::boolean OR c.user_id = $2)
  `, [thread, user.id, author, clientId, content])
  if (!row) throw new HttpError(404, threadMissing)
  if (!row.id) throw new HttpError(429, '发得太快了，请稍后再试。')
  if (row.body !== content) throw new HttpError(409, '这条消息已发送，请重新输入。')
  const message: ChatMessage = { ...presentChatProfile(user.id, row, author),
    id: row.id, body: row.body, sentAt: row.sentAt, mine: true, clientId,
  }
  return { message }
}

export async function markAuthorChatRead(user: VerifiedUser, thread: string, through: unknown) {
  if (typeof through !== 'string' || through === '0' || !validChatCursor(through)) {
    throw new HttpError(400, '消息位置无效。')
  }
  const author = isSiteAuthor(user)
  const [result] = await query<{ unread: boolean }>(`
    WITH read_thread AS (
      UPDATE author_conversations c
      SET ${author ? 'author_read_id = greatest(author_read_id, $4)' : 'user_read_id = greatest(user_read_id, $4)'}
      WHERE c.id = $1 AND ($3::boolean OR c.user_id = $2) AND EXISTS (
        SELECT 1 FROM author_messages m WHERE m.id = $4 AND m.conversation_id = c.id AND m.from_author <> $3
      )
      RETURNING c.id, ${author ? 'last_user_id > author_read_id' : 'last_author_id > user_read_id'} AS unread
    )
    SELECT r.unread OR ($3 AND EXISTS (
      SELECT 1 FROM author_conversations c WHERE c.id <> r.id AND c.last_user_id > c.author_read_id
    )) AS unread FROM read_thread r
  `, [thread, user.id, author, through])
  if (!result) throw new HttpError(404, threadMissing)
  return result
}
