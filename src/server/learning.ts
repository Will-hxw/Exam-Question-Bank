import 'server-only'
import { requireStudyAccount } from '@/features/auth/server'
import { practiceUndonePreference } from '@/features/study/practice-undone'
import { query } from './db'
import { HttpError, uuid } from './http'

export async function account(request: Request, writing = false) {
  return (await requireStudyAccount(request, writing)).id
}

export async function studyStats(user: string) {
  const [stats] = await query<{ attempted: number; wrong: number; favorites: number; preferences: Record<string, unknown> }>(`
    SELECT count(*) FILTER (WHERE p.attempt_count > 0)::int AS attempted,
           count(*) FILTER (WHERE p.is_wrong)::int AS wrong,
           count(f.question_id)::int AS favorites,
           COALESCE((SELECT jsonb_object_agg(name, value) FROM study_preferences WHERE user_id = $1), '{}') AS preferences
    FROM active_bank_questions q
    LEFT JOIN question_progress p ON p.user_id = $1 AND p.question_id = q.id
    LEFT JOIN favorites f ON f.user_id = $1 AND f.question_id = q.id
  `, [user])
  return stats
}

function validPreference(name: string, value: unknown) {
  if (name === 'theme') return value === 'light' || value === 'dark'
  if (name === practiceUndonePreference) return typeof value === 'boolean'
  if (/^practice-position:(topic:[a-z0-9-]{1,50}|random|random-undone|sequence|wrong|favorite)$/.test(name) || /^scroll:(practice|questions|wrong|favorites|exam)$/.test(name)) {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 1000000
  }
  if (!['practice', 'library:all', 'library:wrong', 'library:favorite', 'exam'].includes(name)) return false
  return value !== null && typeof value === 'object' && !Array.isArray(value) && JSON.stringify(value).length <= 1200
}

export async function saveStudyPreferences(user: string, edits: Record<string, unknown>) {
  const entries = Object.entries(edits)
  if (!entries.length || entries.length > 32 || entries.some(([name, value]) => !validPreference(name, value))) {
    throw new HttpError(400, '学习设置格式有误。')
  }
  await query('INSERT INTO profiles (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [user])
  const saved = await query<{ name: string; value: unknown }>(`
    INSERT INTO study_preferences (user_id, name, value)
    SELECT $1, key, value FROM jsonb_each($2::jsonb) ORDER BY key
    ON CONFLICT (user_id, name) DO UPDATE SET value = CASE
      WHEN EXCLUDED.name LIKE 'library:%' THEN study_preferences.value || EXCLUDED.value
      ELSE EXCLUDED.value END
    RETURNING name, value
  `, [user, JSON.stringify(edits)])
  return { ok: true, preferences: Object.fromEntries(saved.map(({ name, value }) => [name, value])) }
}

export async function questionStates(user: string, ids: string[]) {
  type State = { attempted: boolean; isWrong: boolean; isFavorite: boolean }
  const rows = await query<State & { id: string }>(`
    SELECT i.id, COALESCE(p.attempt_count > 0, false) AS attempted,
      COALESCE(p.is_wrong, false) AS "isWrong", f.question_id IS NOT NULL AS "isFavorite"
    FROM unnest($2::uuid[]) i(id)
    JOIN active_bank_questions q ON q.id = i.id
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
