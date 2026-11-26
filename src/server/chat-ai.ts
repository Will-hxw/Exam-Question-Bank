import 'server-only'
import { after } from 'next/server'
import { authorEmail, isSiteAuthor, type VerifiedUser } from '@/features/auth/server'
import { authorNickname, messageLimit, type ChatMessage } from '@/features/chat/types'
import { authorIdSql, presentChatProfile } from './chat'
import { query } from './db'

const mentionPattern = /(?<![A-Za-z0-9_.@])@(?:Hua[ \t]+Xiaowei(?:（作者）(?:（可@AI自动回复）)?)?|作者)(?![A-Za-z0-9_@])/gi
const defaultBaseUrl = 'https://discovery-api.intern-ai.org.cn/v1'
const defaultModel = 'deepseek-v4.1-flash-1017'
const historyLimit = 12
const emailPattern = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi
const unavailable = '（尾巴打了个结）这次没连上，过一会儿再喊我试试看喵 (｡•́︿•̀｡)'
const persona = `你是重庆大学入党积极分子练习站的助手大肥鱼，一只有鲸尾巴的猫娘。平时自称本鱼，亲切、嘴硬一点、会轻轻吐槽，但对同学有耐心。每次用中文短句作答，自然带一处括号里的动作或小声吐槽和一个颜文字，例如「（尾巴摆了两下）」「(｡•̀ᴗ-)✧」。可以偶尔说喵或咕噜。先给有用的回答，再放梗。用户想用别的语言时可以配合。
话题开放，可以回答一般问题、聊天、玩梗和角色扮演。题库由站点维护者整理，参考共产党员网、历年真题和考纲改编，学校党委老师负责正式考试命题，无法保证原题或押题。不确定的题目可以请对方贴出题干或正式材料。
站点地址是 https://cqu.xiaoweihua.cn/。登录后的顶部导航依次为「刷题」「模拟考试」「总题库」「错题集」「收藏夹」。比如想模考，就点顶部「模拟考试」，选择题量后开始。刷题页面的模式栏才有「专题」「随机」「顺序」「错题」「收藏」。「聊天区」和「意见反馈」在页脚，「意见反馈」右上角的小气泡是「作者对话」。
你是站点助手，只能使用当前对话提供的上下文。你无法跨会话查记录、查询用户资料、浏览网页或执行操作。不要替站长或学校承诺，也不要编造已查资料或已执行操作。看见敏感或私人信息时避免在回复中复述。消息会直接显示在聊天气泡里，优先用短段落和纯文本，避免 Markdown 表格。`

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
  return rows.reverse().flatMap(({ body, assistant }) => {
    const content = body.replace(mentionPattern, '').replace(emailPattern, '[邮箱]').trim()
    return content ? [{ role: assistant ? 'assistant' : 'user', content }] : []
  })
}

async function complete(apiKey: string, prompt: string, history: Turn[]) {
  const base = (process.env.DEEPSEEK_API_BASE_URL || defaultBaseUrl).replace(/\/+$/, '')
  const response = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    cache: 'no-store',
    redirect: 'error',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.DEEPSEEK_MODEL || defaultModel,
      messages: [{ role: 'system', content: persona }, ...history, { role: 'user', content: prompt }],
      thinking: { type: 'disabled' }, max_tokens: 450, temperature: 0.65, stream: false,
    }),
    signal: AbortSignal.timeout(8000),
  })
  if (!response.ok) throw new Error(`DeepSeek HTTP ${response.status}`)
  const payload = await response.json()
  const content: unknown = payload?.choices?.[0]?.message?.content
  if (typeof content !== 'string') throw new Error('Empty DeepSeek response')
  const clean = content.replace(/[\x00-\x08\x0b-\x1f\x7f\u202a-\u202e\u2066-\u2069\ud800-\udfff]/gu, '').trim()
  if (!clean) throw new Error('Empty DeepSeek response')
  const budget = messageLimit - 24
  const answer = clean.length <= budget ? clean : clean.slice(0, budget - 1).replace(/[\ud800-\udbff]$/, '').trimEnd() + '…'
  const action = /[（(][^()（）\n]*\p{Script=Han}[^()（）\n]*[）)]/u.test(answer) ? '' : '（轻轻摆尾）'
  const face = /[（(][^()（）\n]{0,10}[•◕ಠωᴗ︶﹏＾▽｡︿][^()（）\n]{0,10}[）)]/u.test(answer) ? '' : ' (｡•̀ᴗ-)✧'
  return action + answer + face
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
  `, [authorEmail, authorNickname, await authorAvatar(), reply, messageId])
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
      const question = prompt.replace(emailPattern, '[邮箱]') || '有同学只 @ 了你，简短打个招呼，问对方需要什么帮助。'
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
