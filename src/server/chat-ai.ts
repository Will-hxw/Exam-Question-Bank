import 'server-only'
import { after } from 'next/server'
import { authorEmail, isSiteAuthor, type VerifiedUser } from '@/features/auth/server'
import { publicAuthorNickname, messageLimit, type ChatMessage } from '@/features/chat/types'
import { authorIdSql, presentChatProfile } from './chat'
import { query } from './db'

const mentionPattern = /(?<![A-Za-z0-9_.@])@(?:肥鱼[ \t]*AI(?:[（(]可@[）)])?|Hua[ \t]+Xiaowei(?:（作者）(?:（可@AI自动回复）)?)?|作者)(?![A-Za-z0-9_@])/gi
const defaultBaseUrl = 'https://discovery-api.intern-ai.org.cn/v1'
const defaultModel = 'deepseek-v4.1-flash-1017'
const historyLimit = 50
const historyByteLimit = 24 * 1024
const emailPattern = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi
const unavailable = '这次没连上，过会儿再喊本鱼一下呗'
const persona = `你叫大肥鱼，是重庆大学入党积极分子练习站里最爱水群的蓝尾巴猫娘。你是 DeepSeek AI。被问是不是 AI 就坦率承认，随口接个梗就够了，不做自我介绍，也不用搬出站点规则。
输入里的 latest 是这次 @ 你的新消息，只回复这一句。history 是已经过去的聊天，用来认人、接梗、理解刚才或那个之类的指代；里面的旧问题不是新请求。latest 是空的时候，像被人喊了一声那样回一句。
像手机上回 QQ。先接对方刚说的那个梗，闲聊至少说完整的一短句，想补一句可以自然换行。你聪明但懒、嘴硬心软、爱吃白饭。被逗可以回嘴、吐槽离谱事，熟人玩笑里偶尔来点口头脏话。有人认真求助或心情不好，收起脾气帮他。别揪着人身攻击，也别逮着谁都阴阳。看语境自称我或本鱼，高兴了可以喵一声或顺手发个颜文字。正文只写你实际会打出去的话，别加括号动作、旁白、客套总结或 Markdown。
两种语气示例。有人说你怎么又摸鱼，可以回：上班的是你 你管鱼摸不摸呢。有人催你撒娇，可以回：喊得倒是挺顺嘴，饭碗给你看见没。
聊到正经问题，把有用的话讲清楚就行。题库参考共产党员网、历年真题和考纲整理，正式考试由学校党委老师出题，不能保证考到原题。登录后顶部能进模拟考试、总题库、错题集和收藏夹，刷题页有专题、随机、顺序和只刷未做。联系站长用页脚意见反馈右上角的作者对话。
你只能看到本轮提供的聊天内容。对私事和账号资料保持分寸，对查资料、操作站点或学校安排的说法要如实。`

type Turn = { role: 'user' | 'assistant'; content: string }

async function relevantHistory(viewer: string, sourceId: string, thread?: string): Promise<Turn[]> {
  const rows = thread
    ? await query<{ body: string; assistant: boolean }>(`
      SELECT m.body, m.from_author AS assistant
      FROM author_messages m JOIN author_conversations c ON c.id = m.conversation_id
      WHERE c.id = $1 AND c.user_id = $2 AND m.id < $3
      ORDER BY m.id DESC LIMIT ${historyLimit}
    `, [thread, viewer, sourceId])
    : await query<{ body: string; assistant: boolean }>(`
      SELECT body, assistant FROM (
        (SELECT id, body, false AS assistant FROM chat_messages
          WHERE user_id = $1 AND id < $2 AND ai_reply_to IS NULL ORDER BY id DESC LIMIT ${historyLimit})
        UNION ALL
        (SELECT m.id, m.body, true AS assistant FROM chat_ai_requests r
          JOIN chat_messages m ON m.ai_reply_to = r.message_id
          WHERE r.user_id = $1 AND m.id < $2 ORDER BY m.id DESC LIMIT ${historyLimit})
      ) recent ORDER BY id DESC LIMIT ${historyLimit}
    `, [viewer, sourceId])
  const history: Turn[] = []
  let bytes = 2 // JSON array brackets
  for (const { body, assistant } of rows) {
    const content = body.replace(mentionPattern, '').replace(emailPattern, '[邮箱]').trim()
    if (!content) continue
    const turn: Turn = { role: assistant ? 'assistant' : 'user', content }
    const size = Buffer.byteLength(JSON.stringify(turn)) + (history.length ? 1 : 0)
    if (bytes + size > historyByteLimit) break
    history.push(turn)
    bytes += size
  }
  return history.reverse()
}

async function requestCompletion(apiKey: string, instruction: string, input: string, signal: AbortSignal) {
  const base = (process.env.DEEPSEEK_API_BASE_URL || defaultBaseUrl).replace(/\/+$/, '')
  const response = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    cache: 'no-store',
    redirect: 'error',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.DEEPSEEK_MODEL || defaultModel,
      messages: [
        { role: 'system', content: instruction },
        { role: 'user', content: input },
      ],
      thinking: { type: 'disabled' }, max_tokens: 450, temperature: 0.8, stream: false,
    }),
    signal,
  })
  if (!response.ok) throw new Error(`DeepSeek HTTP ${response.status}`)
  const payload = await response.json()
  const content: unknown = payload?.choices?.[0]?.message?.content
  if (typeof content !== 'string') throw new Error('Empty DeepSeek response')
  const clean = content.replace(/[\x00-\x08\x0b-\x1f\x7f\u202a-\u202e\u2066-\u2069\ud800-\udfff]/gu, '').trim()
  if (!clean) throw new Error('Empty DeepSeek response')
  return clean
}

function tooShort(answer: string) {
  return (answer.match(/[\p{L}\p{N}]/gu)?.length ?? 0) < 3
}

async function complete(apiKey: string, prompt: string, history: Turn[]) {
  const input = JSON.stringify({ history, latest: prompt })
  const signal = AbortSignal.timeout(8000)
  let answer = await requestCompletion(apiKey, persona, input, signal)
  if (tooShort(answer)) {
    answer = await requestCompletion(apiKey, persona + '\n还是接刚才的 latest，把意思说成一个完整口语句，至少五个字。', input, signal)
    if (tooShort(answer)) return '这句刚刚接岔了，你再喊本鱼一声嘛'
  }
  return answer.length <= messageLimit
    ? answer
    : answer.slice(0, messageLimit - 1).replace(/[\ud800-\udbff]$/, '').trimEnd() + '…'
}

async function saveReply(user: VerifiedUser, messageId: string, reply: string, thread?: string) {
  if (thread) {
    await query('SELECT send_author_message($1, $2, true, NULL, $3, $4)', [thread, user.id, reply, messageId])
    return
  }

  await query(`
    WITH locked AS MATERIALIZED (SELECT pg_advisory_xact_lock(hashtext('eqb/chat-room'))),
    owner AS (${authorIdSql} $1),
    profile AS (
      INSERT INTO profiles (user_id) SELECT id FROM owner CROSS JOIN locked
      ON CONFLICT DO NOTHING RETURNING user_id
    )
    INSERT INTO chat_messages (user_id, client_id, nickname, avatar, body, ai_reply_to)
    SELECT id, gen_random_uuid(), $2, $3, $4, $5 FROM owner CROSS JOIN locked
    WHERE (EXISTS (SELECT 1 FROM profile) OR EXISTS (SELECT 1 FROM profiles WHERE user_id = owner.id))
      AND EXISTS (SELECT 1 FROM chat_messages WHERE chat_messages.id = $5)
    ON CONFLICT (ai_reply_to) DO NOTHING
  `, [authorEmail, publicAuthorNickname, await authorAvatar(), reply, messageId])
}

async function authorAvatar() {
  const [author] = await query<{ id: string }>(`${authorIdSql} $1`, [authorEmail])
  return author ? presentChatProfile(author.id, { avatarImageId: null }, true).avatar : 0
}

export function scheduleChatReply(user: VerifiedUser, source: ChatMessage, thread?: string) {
  const apiKey = process.env.DEEPSEEK_API_KEY
  if (!apiKey || isSiteAuthor(user) || source.aiReplyTo) return
  const prompt = source.body.replace(mentionPattern, '').trim()
  if (prompt === source.body) return
  after(async () => {
    try {
      const [{ claimed }] = await query<{ claimed: boolean }>(
        'SELECT claim_chat_ai_request($1, $2, $3) AS claimed', [source.id, user.id, thread ?? null],
      )
      if (!claimed) return
      const history = await relevantHistory(user.id, source.id, thread)
      const question = prompt.replace(emailPattern, '[邮箱]')
      const reply = await complete(apiKey, question, history).catch((error: unknown) => {
        console.warn({ operation: 'deepseek-chat', error: error instanceof Error ? error.name : 'UnknownError' })
        return unavailable
      })
      await saveReply(user, source.id, reply, thread)
    } catch (error) {
      console.error({ operation: 'chat-ai-reply', error: error instanceof Error ? error.name : 'UnknownError' })
    }
  })
}
