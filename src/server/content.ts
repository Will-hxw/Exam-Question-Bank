import 'server-only'
import { randomUUID } from 'node:crypto'
import { unstable_cache } from 'next/cache'
import type { PracticePosition } from '@/features/study/practice-undone'
import { query } from './db'
import { HttpError, uuid } from './http'

export const CONTENT_TAG = 'published-content'
const cacheOptions = { tags: [CONTENT_TAG], revalidate: 180 }

type BasicOption = { id: string; text: string; rationale?: string }
export type PracticeQuestion = {
  id: string
  type: 'single' | 'multiple'
  stem: string
  contentRevision?: string
  topicId: string
  options: BasicOption[]
  answerIds?: string[]
  explanation?: string
  sources?: Array<{ title: string; url: string; location: string }>
  isFavorite?: boolean
  attempted?: boolean
  isWrong?: boolean
}

type Filters = {
  topic: string | null
  type: string | null
  q: string | null
  cursor: string | null
  offset: number
  limit: number
  practice: boolean
  random: string | null
  status: string | null
}

export function questionFilters(url: URL, personal = false): Filters {
  const p = url.searchParams
  const allowed = new Set(['topic', 'type', 'q', 'cursor', 'offset', 'limit', 'mode', 'random'])
  if (personal) allowed.add('status')
  const integer = (key: string, fallback: number, min: number, max: number) => {
    const value = p.get(key)
    if (value === null) return fallback
    const parsed = Number(value)
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
      throw new HttpError(400, '分页参数无效。')
    }
    return parsed
  }
  const topic = p.get('topic')
  const type = p.get('type')
  const q = p.get('q')?.normalize('NFKC').toLowerCase().trim() || null
  const cursor = p.get('cursor')
  const mode = p.get('mode')
  const random = p.get('random')
  const status = p.get('status')
  if (
    [...p.keys()].some(key => !allowed.has(key) || p.getAll(key).length > 1)
    || (topic !== null && !/^[a-z0-9][a-z0-9-]{0,49}$/.test(topic))
    || (type !== null && !['single', 'multiple'].includes(type))
    || (q && q.length > 100)
    || (cursor !== null && p.has('offset'))
    || (mode !== null && mode !== 'practice')
    || (random !== null && (mode !== 'practice' || cursor !== null || p.has('offset')))
    || (status !== null && !['done', 'undone', 'wrong', 'favorite'].includes(status))
  ) throw new HttpError(400, '题目筛选参数无效。')
  return {
    topic, type, q, cursor: cursor === null ? null : uuid(cursor), offset: integer('offset', 0, 0, 100000),
    limit: integer('limit', 15, 1, 50), practice: mode === 'practice', random: random === '1' ? randomUUID() : random === null ? null : uuid(random), status,
  }
}

const optionProjection = `
  COALESCE((SELECT jsonb_agg(
    jsonb_build_object('id', o.id, 'text', o.text) ||
    CASE WHEN $7 THEN jsonb_build_object('rationale', o.rationale) ELSE '{}'::jsonb END
    ORDER BY o.position
  ) FROM question_options o WHERE o.question_id = q.id), '[]'::jsonb)
`

const evidenceProjection = `
  COALESCE((SELECT jsonb_agg(source ORDER BY source->>'title', source->>'location') FROM (
    SELECT DISTINCT jsonb_build_object('title', s.title, 'url', s.url, 'location', e.location) AS source
    FROM question_evidence e JOIN sources s ON s.id = e.source_id WHERE e.question_id = q.id
  ) AS distinct_sources), '[]'::jsonb)
`

export const bankRelease = unstable_cache(async () => ({
  release: (await query<{ digest: string }>('SELECT digest FROM content_release'))[0]?.digest ?? null,
}), ['bank-release'], { ...cacheOptions, revalidate: 10 })

function topicsAtRelease(release: string | null) {
  return unstable_cache(async () => ({
    topics: await query<{ id: string; name: string; count: number }>(`
      SELECT t.id, t.name, t.scope_note AS "scopeNote", count(q.id)::int AS count
      FROM topics t LEFT JOIN questions q ON q.topic_id = t.id AND q.status = 'published'
      WHERE t.active GROUP BY t.id ORDER BY t.sort_order
    `),
  }), ['topic-list', release ?? 'unregistered'], cacheOptions)()
}

export async function topics() {
  return topicsAtRelease((await bankRelease()).release)
}

const orderedPracticeBank = `
  SELECT q.id, (row_number() OVER (ORDER BY q.bank_position NULLS LAST, q.id) - 1)::int AS position
  FROM active_bank_questions q
  WHERE ($2::text IS NULL OR q.topic_id = $2)
`

function practiceTopic(params: URLSearchParams) {
  const topic = params.get('topic')
  if ([...params.keys()].some((key) => key !== 'topic') || params.getAll('topic').length > 1
    || (topic !== null && !/^[a-z0-9][a-z0-9-]{0,49}$/.test(topic))) {
    throw new HttpError(400, '专题参数无效。')
  }
  return topic
}

export async function practiceBookmarkPosition(id: string, params: URLSearchParams) {
  const [entry] = await query<Pick<PracticePosition, 'position'>>(`
    SELECT position FROM (${orderedPracticeBank}) ordered WHERE id = $1
  `, [id, practiceTopic(params)])
  return { position: entry?.position ?? null }
}

export async function practiceUndonePositions(userId: string, params: URLSearchParams) {
  const positions = await query<PracticePosition>(`
    WITH ordered AS (${orderedPracticeBank})
    SELECT o.id, o.position FROM ordered o
    WHERE NOT EXISTS (
      SELECT 1 FROM question_progress p
      WHERE p.question_id = o.id AND p.user_id = $1 AND p.attempt_count > 0
    )
    ORDER BY o.position
  `, [userId, practiceTopic(params)])
  return { positions }
}

export async function questionPage(filters: Filters, userId: string | null = null) {
  const { topic, type, q, cursor, offset, limit, practice, random, status } = filters
  const pattern = q ? '%' + q.replace(/[!%_]/g, char => '!' + char) + '%' : null
  const [{ questions, total }] = await query<{ questions: PracticeQuestion[]; total: number }>(`
    WITH matched AS (
      SELECT q.id, COALESCE(q.bank_position, 2147483647) AS bank_position,
             p.question_id IS NOT NULL AND p.attempt_count > 0 AS attempted,
             COALESCE(p.is_wrong, false) AS is_wrong, f.question_id IS NOT NULL AS favorite
      FROM active_bank_questions q
      LEFT JOIN question_progress p ON p.user_id = $9 AND p.question_id = q.id
      LEFT JOIN favorites f ON f.user_id = $9 AND f.question_id = q.id
      WHERE ($1::text IS NULL OR q.topic_id = $1)
        AND ($2::text IS NULL OR q.type = $2)
        AND ($3::text IS NULL OR q.search_text ILIKE $3 ESCAPE '!' OR EXISTS (
          SELECT 1 FROM question_options o WHERE o.question_id = q.id AND normalize(o.text, NFKC) ILIKE $3 ESCAPE '!'
        ))
        AND ($10::text IS NULL OR CASE $10
          WHEN 'done' THEN COALESCE(p.attempt_count, 0) > 0
          WHEN 'undone' THEN COALESCE(p.attempt_count, 0) = 0
          WHEN 'wrong' THEN p.is_wrong
          WHEN 'favorite' THEN f.question_id IS NOT NULL
        END)
    ), page AS (
      SELECT m.*, ($8::uuid IS NOT NULL AND m.id < $8) AS wrap,
        CASE WHEN $8::uuid IS NULL THEN m.bank_position ELSE 0 END AS sort_position
      FROM matched m
      WHERE $4::uuid IS NULL OR (m.bank_position, m.id) > (
        COALESCE((SELECT o.position FROM question_bank_positions o WHERE o.question_id = $4), 2147483647), $4
      )
      ORDER BY wrap, sort_position, m.id
      OFFSET $5 LIMIT $6
    ), entries AS (
      SELECT m.id, m.wrap, m.sort_position,
        jsonb_build_object('id', q.id, 'type', q.type, 'stem', q.stem, 'topicId', q.topic_id,
          'options', ${optionProjection}) ||
        CASE WHEN q.content_revision IS NOT NULL THEN jsonb_build_object('contentRevision', q.content_revision)
          ELSE '{}'::jsonb END ||
        CASE WHEN $7 THEN jsonb_build_object(
          'answerIds', (SELECT jsonb_agg(a.option_id ORDER BY a.option_id) FROM question_answers a WHERE a.question_id = q.id),
          'explanation', (SELECT e.explanation FROM question_explanations e WHERE e.question_id = q.id),
          'sources', ${evidenceProjection}
        ) ELSE '{}'::jsonb END ||
        CASE WHEN $9::text IS NOT NULL THEN jsonb_build_object(
          'isFavorite', m.favorite, 'attempted', m.attempted, 'isWrong', m.is_wrong
        ) ELSE '{}'::jsonb END AS data
      FROM page m JOIN questions q USING (id)
    )
    SELECT (SELECT count(*)::int FROM matched) AS total,
      COALESCE(jsonb_agg(data ORDER BY wrap, sort_position, id), '[]'::jsonb) AS questions
      FROM entries
  `, [topic, type, pattern, cursor, offset, limit + 1, practice, random, userId, status])

  const hasMore = questions.length > limit
  if (hasMore) questions.pop()
  const nextCursor = !random && hasMore ? questions.at(-1)?.id ?? null : null
  return { questions, nextCursor, total }
}

export async function publicQuestions(filters: Filters) {
  const { topic, type, q, cursor, offset, limit, practice, random } = filters
  if (!type && !q && !cursor && !offset && !random && (limit === 15 || (limit === 20 && !practice))) {
    const { release } = await bankRelease()
    if (topic && !(await topicsAtRelease(release)).topics.some(candidate => candidate.id === topic)) {
      throw new HttpError(404, '专题不存在。')
    }
    return unstable_cache(
      (topic: string | null, practice: boolean, limit: number) => questionPage({
        topic, type: null, q: null, cursor: null, offset: 0, limit, practice, random: null, status: null,
      }),
      ['first-question-page', release ?? 'unregistered'],
      cacheOptions,
    )(topic, practice, limit)
  }
  return questionPage(filters)
}

export async function explanation(id: string) {
  const [row] = await query<Required<Pick<PracticeQuestion, 'answerIds' | 'explanation' | 'options' | 'sources'>>>(`
    SELECT (SELECT jsonb_agg(a.option_id ORDER BY a.option_id) FROM question_answers a WHERE a.question_id = q.id) AS "answerIds",
           x.explanation, ${optionProjection.replaceAll('$7', 'true')} AS options, ${evidenceProjection} AS sources
    FROM questions q JOIN question_explanations x ON x.question_id = q.id
    JOIN topics t ON t.id = q.topic_id AND t.active
    WHERE q.id = $1 AND q.status = 'published'
  `, [id])
  if (!row) throw new HttpError(404, '该题已下架或不存在。')
  return row
}
