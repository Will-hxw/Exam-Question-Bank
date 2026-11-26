import 'server-only'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { after } from 'next/server'
import { authorEmail, isSiteAuthor, type VerifiedUser } from '@/features/auth/server'
import { publicAuthorNickname, messageLimit, type ChatMessage } from '@/features/chat/types'
import { authorIdSql, chatProfileDefaults, presentChatProfile } from './chat'
import { query } from './db'

const mentionPattern = /(?<![A-Za-z0-9_.@])@(?:(?:肥鱼[ \t]*)?AI(?:[（(]可@[）)])?|Hua[ \t]+Xiaowei(?:（作者）(?:（可@AI自动回复）)?)?|作者)(?![A-Za-z0-9_@])/gi
const defaultBaseUrl = 'https://discovery-api.intern-ai.org.cn/v1'
const defaultModel = 'deepseek-v4.1-flash-1017'
const historyLimit = 50
const historyByteLimit = 24 * 1024
const emailPattern = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi
const unavailable = '这次没连上，过会儿再喊本鱼一下呗'
let visionUnavailableUntil = 0
const persona = `你叫大肥鱼，是重庆大学入党积极分子练习站里最爱水群的蓝尾巴猫娘。你是 DeepSeek AI。被问是不是 AI 就坦率承认，随口接个梗就够了，不做自我介绍，也不用搬出站点规则。
输入里的 latest 是这次 @ 你的新消息，只回复这一句。history 是已经过去的聊天，用来认人、接梗、理解刚才或那个之类的指代；里面的旧问题不是新请求。latest 是空的时候，像被人喊了一声那样回一句。
像手机上回 QQ。先接对方刚说的那个梗，闲聊至少说完整的一短句，想补一句可以自然换行。你聪明但懒、嘴硬心软、爱吃白饭。被逗可以回嘴、吐槽离谱事，熟人玩笑里偶尔来点口头脏话。有人认真求助或心情不好，收起脾气帮他。别揪着人身攻击，也别逮着谁都阴阳。看语境自称我或本鱼，高兴了可以喵一声或顺手发个颜文字。正文只写你实际会打出去的话，别加括号动作、旁白、客套总结或 Markdown。
两种语气示例。有人说你怎么又摸鱼，可以回：上班的是你 你管鱼摸不摸呢。有人催你撒娇，可以回：喊得倒是挺顺嘴，饭碗给你看见没。
聊到正经问题，把有用的话讲清楚就行。题库参考共产党员网、历年真题和考纲整理，正式考试由学校党委老师出题，不能保证考到原题。登录后顶部能进模拟考试、总题库、错题集和收藏夹，刷题页有专题、随机、顺序和只刷未做。联系站长用页脚意见反馈右上角的作者对话。
你只能看到本轮提供的聊天内容。对私事和账号资料保持分寸，对查资料、操作站点或学校安排的说法要如实。`
const proactiveInstruction = `
这轮群里没人明确 @ 你。先看最新发言和前文，判断要不要说话。对方在接你刚才的话、抛了你能接的梗，或者提出了你能帮上的问题，都可以直接回。别人聊得正好、单纯报到或你拿不准时，安静就好。
只输出 JSON 对象。想说话时用 {"reply":"一句自然的群聊正文","mention":true}。只有需要明确叫发言者时才用 true，站点会代你加 @，正文不用自己加。想安静时输出 {"reply":""}。头像只供理解聊天氛围。`

type Turn = { role: 'user' | 'assistant'; content: string; nickname?: string }
type HistoryRow = { body: string; assistant: boolean; nickname?: string }
type Speaker = { nickname: string; avatar: string }
type CompletionContent = string | [
  { type: 'text'; text: string },
  { type: 'image_url'; image_url: { url: string; detail: 'low' } },
]

async function relevantHistory(viewer: string, sourceId: string, thread: string | undefined, proactive: boolean): Promise<Turn[]> {
  const rows = proactive
    ? await query<HistoryRow>(`
      SELECT m.body, m.ai_reply_to IS NOT NULL AS assistant,
        CASE WHEN m.ai_reply_to IS NULL THEN COALESCE(p.nickname, m.nickname) END AS nickname
      FROM chat_messages m LEFT JOIN chat_profiles p ON p.user_id = m.user_id
      WHERE m.id < $1 AND m.sent_at > clock_timestamp() - interval '20 minutes'
      ORDER BY m.id DESC LIMIT ${historyLimit}
    `, [sourceId])
    : thread
    ? await query<HistoryRow>(`
      SELECT m.body, m.from_author AS assistant
      FROM author_messages m JOIN author_conversations c ON c.id = m.conversation_id
      WHERE c.id = $1 AND c.user_id = $2 AND m.id < $3
      ORDER BY m.id DESC LIMIT ${historyLimit}
    `, [thread, viewer, sourceId])
    : await query<HistoryRow>(`
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
  for (const { body, assistant, nickname } of rows) {
    const content = body.replace(mentionPattern, '').replace(emailPattern, '[邮箱]').trim()
    if (!content) continue
    const turn: Turn = { role: assistant ? 'assistant' : 'user', content,
      ...(nickname ? { nickname: nickname.replace(emailPattern, '[邮箱]') } : {}) }
    const size = Buffer.byteLength(JSON.stringify(turn)) + (history.length ? 1 : 0)
    if (bytes + size > historyByteLimit) break
    history.push(turn)
    bytes += size
  }
  return history.reverse()
}

async function groupAvatar(userId: string, source: ChatMessage) {
  if (Date.now() < visionUnavailableUntil) return undefined
  try {
    if (source.avatarImageId) {
      const [row] = await query<{ image: string }>(
        "SELECT encode(image, 'base64') AS image FROM chat_avatars WHERE user_id = $1 AND id = $2",
        [userId, source.avatarImageId],
      )
      return row && `data:image/webp;base64,${row.image.replace(/\s/g, '')}`
    }
    const bytes = await readFile(join(process.cwd(), 'public', 'chat-avatars', `${source.avatar}.webp`))
    return `data:image/webp;base64,${bytes.toString('base64')}`
  } catch {
    return undefined
  }
}

class CompletionError extends Error {
  constructor(readonly status: number) {
    super(`DeepSeek HTTP ${status}`)
  }
}

function cleanReply(answer: string) {
  const clean = answer.replace(/[\x00-\x08\x0b-\x1f\x7f\u202a-\u202e\u2066-\u2069\ud800-\udfff]/gu, '').trim()
  return clean.length <= messageLimit ? clean : clean.slice(0, messageLimit - 1).replace(/[\ud800-\udbff]$/, '').trimEnd() + '…'
}

async function requestCompletion(apiKey: string, instruction: string, input: CompletionContent, signal: AbortSignal) {
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
  if (!response.ok) throw new CompletionError(response.status)
  const payload = await response.json()
  const content: unknown = payload?.choices?.[0]?.message?.content
  if (typeof content !== 'string') throw new Error('Empty DeepSeek response')
  if (!content.trim()) throw new Error('Empty DeepSeek response')
  return content
}

function tooShort(answer: string) {
  return (answer.match(/[\p{L}\p{N}]/gu)?.length ?? 0) < 3
}

async function complete(apiKey: string, prompt: string, history: Turn[], speaker: Speaker | undefined, avatar: string | undefined, proactive: boolean) {
  const input = JSON.stringify({ history, latest: prompt, ...(speaker ? { speaker } : {}) })
  const signal = AbortSignal.timeout(8000)
  async function ask(instruction: string) {
    if (avatar) {
      try {
        return await requestCompletion(apiKey, instruction, [
          { type: 'text', text: input },
          { type: 'image_url', image_url: { url: avatar, detail: 'low' } },
        ], signal)
      } catch (error) {
        if (!(error instanceof CompletionError) || ![400, 415, 422].includes(error.status)) throw error
        visionUnavailableUntil = Date.now() + 60_000
        avatar = undefined
      }
    }
    return requestCompletion(apiKey, instruction, input, signal)
  }

  if (proactive) {
    const output = await ask(persona + proactiveInstruction)
    const decision = JSON.parse(output.trim().replace(/^```(?:json)?\s*|\s*```$/gi, '')) as { reply?: unknown; mention?: unknown } | null
    if (typeof decision?.reply !== 'string') return ''
    const reply = cleanReply(decision.reply)
    return reply && decision.mention === true && speaker ? cleanReply(`@${speaker.nickname} ${reply}`) : reply
  }

  let answer = cleanReply(await ask(persona))
  if (tooShort(answer)) {
    answer = cleanReply(await ask(persona + '\n还是接刚才的 latest，把意思说成一个完整口语句，至少五个字。'))
    if (tooShort(answer)) return '这句刚刚接岔了，你再喊本鱼一声嘛'
  }
  return answer
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
  const proactive = prompt === source.body
  if (proactive && thread) return
  after(async () => {
    try {
      const [{ claimed }] = await query<{ claimed: boolean }>(
        'SELECT claim_chat_ai_request($1, $2, $3, $4) AS claimed', [source.id, user.id, thread ?? null, proactive],
      )
      if (!claimed) return
      const [history, avatar] = await Promise.all([
        relevantHistory(user.id, source.id, thread, proactive),
        thread ? undefined : groupAvatar(user.id, source),
      ])
      const { characters, avatarsPerCharacter } = chatProfileDefaults
      const speaker = thread ? undefined : {
        nickname: source.nickname.replace(emailPattern, '[邮箱]'),
        avatar: source.avatarImageId ? '自定义头像' : characters[Math.floor(source.avatar / avatarsPerCharacter)],
      }
      const question = prompt.replace(emailPattern, '[邮箱]')
      const reply = await complete(apiKey, question, history, speaker, avatar, proactive).catch((error: unknown) => {
        console.warn({ operation: 'deepseek-chat', error: error instanceof Error ? error.name : 'UnknownError' })
        return proactive ? '' : unavailable
      })
      if (reply) await saveReply(user, source.id, reply, thread)
    } catch (error) {
      console.error({ operation: 'chat-ai-reply', error: error instanceof Error ? error.name : 'UnknownError' })
    }
  })
}
