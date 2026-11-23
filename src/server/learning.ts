import 'server-only'
import { getAuth, getVerifiedUser } from '@/features/auth/server'
import { query } from './db'
import { HttpError, sameOrigin, uuid } from './http'

export async function account(request: Request, writing = false) {
  if (writing) sameOrigin(request)
  if (!getAuth()) throw new HttpError(503, '账号服务暂未配置。')
  const user = await getVerifiedUser()
  if (!user) throw new HttpError(401, '请登录并验证邮箱。')
  if (writing && request.headers.get('x-study-account') !== user.id) {
    throw new HttpError(409, '当前账号已切换，请刷新后再试。')
  }
  return user.id
}

export async function studyStats(user: string) {
  const [stats] = await query<{ attempted: number; wrong: number; favorites: number }>(`
    SELECT count(*) FILTER (WHERE attempt_count > 0)::int AS attempted,
           count(*) FILTER (WHERE is_wrong)::int AS wrong,
           (SELECT count(*)::int FROM favorites WHERE user_id = $1) AS favorites
    FROM question_progress WHERE user_id = $1
  `, [user])
  return stats
}

export async function questionStates(user: string, ids: string[]) {
  type State = { attempted: boolean; isWrong: boolean; isFavorite: boolean }
  const rows = await query<State & { id: string }>(`
    SELECT i.id, COALESCE(p.attempt_count > 0, false) AS attempted,
      COALESCE(p.is_wrong, false) AS "isWrong", f.question_id IS NOT NULL AS "isFavorite"
    FROM unnest($2::uuid[]) i(id)
    LEFT JOIN question_progress p ON p.user_id = $1 AND p.question_id = i.id
    LEFT JOIN favorites f ON f.user_id = $1 AND f.question_id = i.id
  `, [user, ids])
  return { states: Object.fromEntries(rows.map(({ id, ...state }) => [id, state])) }
}

export function optionIds(input: unknown) {
  if (!Array.isArray(input) || input.length > 6) throw new HttpError(400, '选项格式有误。')
  const result = input.map(uuid)
  if (new Set(result).size !== result.length) throw new HttpError(400, '选项重复。')
  return result
}

export async function saveAttempts(user: string, body: Record<string, unknown>) {
  if (body.ownerId !== user) throw new HttpError(409, '待同步作答属于另一账号。')
  if (!Array.isArray(body.events) || body.events.length < 1 || body.events.length > 50) {
    throw new HttpError(400, '每批应包含 1 至 50 条作答。')
  }
  const events = body.events.map(event => {
    if (!event || event.mode !== 'practice') throw new HttpError(400, '作答模式无效。')
    const revision = event.contentRevision
    if (revision !== undefined && (typeof revision !== 'string' || !/^[a-f0-9]{64}$/.test(revision))) {
      throw new HttpError(400, '题目内容标识无效。')
    }
    return { eventId: uuid(event.eventId), questionId: uuid(event.questionId), optionIds: optionIds(event.optionIds), contentRevision: revision }
  })
  const [row] = await query<{ results: Array<{ eventId: string; status: string; correct?: boolean }> }>(
    'SELECT record_practice_batch($1, $2) AS results',
    [user, JSON.stringify(events)],
  )
  return row
}

export async function favorite(user: string, id: string, value: unknown) {
  if (typeof value !== 'boolean') throw new HttpError(400, '收藏状态无效。')
  const [row] = await query<{ ok: boolean }>('SELECT set_favorite($1, $2, $3) AS ok', [user, id, value])
  if (!row.ok) throw new HttpError(404, '该题已下架或不存在。')
  return row
}

export async function dismissWrong(user: string, id: string) {
  await query(`
    UPDATE question_progress SET is_wrong = false, correct_streak = 0, updated_at = now()
    WHERE user_id = $1 AND question_id = $2
  `, [user, id])
  return { ok: true }
}
