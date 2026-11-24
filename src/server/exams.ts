import 'server-only'
import { randomInt } from 'node:crypto'
import { DEFAULT_EXAM_QUESTIONS, isExamQuestionCount, MAX_EXAM_QUESTIONS, MIN_EXAM_QUESTIONS } from '@/features/study/exam-size'
import { query } from './db'
import { HttpError, uuid } from './http'
import { optionIds } from './learning'

type Candidate = { id: string; topic: string; facts: string[]; emotionOnly: boolean }

function shuffle<T>(list: T[]): void {
  for (let index = list.length - 1; index > 0; index--) {
    const other = randomInt(index + 1)
    ;[list[index], list[other]] = [list[other], list[index]]
  }
}

function selectCandidates(candidates: Candidate[], questionCount: number) {
  const queueByTopic = new Map<string, Candidate[]>()
  for (const candidate of candidates) {
    const queue = queueByTopic.get(candidate.topic)
    if (queue) queue.push(candidate)
    else queueByTopic.set(candidate.topic, [candidate])
  }
  const queues = [...queueByTopic.values()]
  queues.forEach(shuffle)
  shuffle(queues)
  const selected: string[] = []
  const selectedFacts = new Set<string>()
  const cueLimit = Math.floor(questionCount / 10)
  let cueCount = 0
  while (selected.length < questionCount && queues.some(queue => queue.length)) {
    for (const queue of queues) {
      while (queue.length) {
        const candidate = queue.pop()!
        if (candidate.facts.some(fact => selectedFacts.has(fact)) || (candidate.emotionOnly && cueCount >= cueLimit)) continue
        selected.push(candidate.id)
        for (const fact of candidate.facts) selectedFacts.add(fact)
        if (candidate.emotionOnly) cueCount++
        break
      }
      if (selected.length === questionCount) break
    }
  }
  shuffle(selected)
  return selected
}

const summaryFields = `
  s.id, s.status, s.started_at AS "startedAt", s.submitted_at AS "submittedAt",
  s.revision, s.position, s.score, s.question_count AS total
`

export async function examHistory(user: string) {
  return { exams: await query(`
    SELECT ${summaryFields} FROM exam_sessions s WHERE s.user_id = $1
    ORDER BY (status = 'draft') DESC, started_at DESC LIMIT 30
  `, [user]) }
}

export async function examDetails(user: string, id: string) {
  const [exam] = await query(`
    SELECT ${summaryFields}, s.answers, s.marked,
      (SELECT jsonb_agg(
        i.question || CASE WHEN s.status = 'submitted'
          THEN i.review || jsonb_build_object('answerIds', i.answer_ids) ELSE '{}'::jsonb END
        ORDER BY i.position)
        FROM exam_items i WHERE i.exam_id = s.id) AS items,
      CASE WHEN s.status = 'submitted' THEN (
        SELECT jsonb_object_agg(i.question_id,
          i.answer_ids = ARRAY(SELECT value::uuid FROM jsonb_array_elements_text(COALESCE(s.answers->i.question_id::text, '[]'))
            ORDER BY value::uuid))
        FROM exam_items i WHERE i.exam_id = s.id
      ) END AS correctness
    FROM exam_sessions s WHERE s.user_id = $1 AND s.id = $2
  `, [user, id])
  if (!exam) throw new HttpError(404, '未找到试卷。')
  return { exam }
}

export async function createExam(user: string, questionCount: unknown = DEFAULT_EXAM_QUESTIONS) {
  if (!isExamQuestionCount(questionCount)) {
    throw new HttpError(400, `考试题数须为 ${MIN_EXAM_QUESTIONS} 至 ${MAX_EXAM_QUESTIONS} 的整数。`)
  }
  const [draft] = await query<{ id: string }>(
    "SELECT id FROM exam_sessions WHERE user_id = $1 AND status = 'draft'", [user],
  )
  if (draft) return examDetails(user, draft.id)

  const candidates = await query<Candidate>(`
    SELECT q.id, q.topic_id AS topic, q.emotion_only AS "emotionOnly",
      ARRAY[q.knowledge_point_id] || ARRAY(
        SELECT k.knowledge_point_id FROM question_knowledge_points k WHERE k.question_id = q.id
      ) AS facts
    FROM questions q JOIN topics t ON t.id = q.topic_id AND t.active
    WHERE q.status = 'published'
      AND (q.type = 'single' OR
        (SELECT count(*) FROM question_options o WHERE o.question_id = q.id)
          > (SELECT count(*) FROM question_answers a WHERE a.question_id = q.id))
  `)
  const selected = selectCandidates(candidates, questionCount)
  if (selected.length !== questionCount) throw new HttpError(409, `满足组卷要求的已审核题目尚不足 ${questionCount} 道，请减少题数后重试。`)
  const [row] = await query<{ id: string | null }>('SELECT start_exam($1, $2) AS id', [user, selected])
  if (!row.id) throw new HttpError(409, '题库刚刚更新，请重新开始考试。')
  return examDetails(user, row.id)
}

export async function replayExam(user: string, source: string) {
  const [row] = await query<{ id: string | null; outcome: string }>(
    'SELECT exam_id AS id, outcome FROM replay_exam($1, $2)', [user, source],
  )
  if (row.outcome === 'draft') throw new HttpError(409, '你有一份未交卷的试卷，请先继续完成。')
  if (!row.id) throw new HttpError(404, '未找到可重考的试卷。')
  return examDetails(user, row.id)
}

export async function saveExam(user: string, id: string, body: Record<string, unknown>, submit: boolean, acknowledgeOnly = false) {
  const { position, revision, answers, marked } = body
  if (typeof position !== 'number' || !Number.isInteger(position) || position < 0 || position >= MAX_EXAM_QUESTIONS
    || typeof revision !== 'number' || !Number.isInteger(revision) || revision < 0 || revision >= 2147483647
    || !answers || typeof answers !== 'object' || Array.isArray(answers)
    || !Array.isArray(marked) || marked.length > MAX_EXAM_QUESTIONS || Object.keys(answers).length > MAX_EXAM_QUESTIONS) {
    throw new HttpError(400, '试卷草稿格式有误。')
  }
  const normalized = Object.fromEntries(Object.entries(answers).map(([key, value]) => [uuid(key), optionIds(value)]))
  const marks = [...new Set(marked.map(uuid))]
  const [row] = await query<{ status: string }>(
    'SELECT update_exam($1, $2, $3, $4, $5, $6, $7) AS status',
    [user, id, revision, position, marks, JSON.stringify(normalized), submit],
  )
  switch (row.status) {
    case 'ok': return acknowledgeOnly && !submit ? { revision: revision + 1 } : examDetails(user, id)
    case 'missing': throw new HttpError(404, '未找到试卷。')
    case 'invalid_position': throw new HttpError(400, '题号超出这份试卷的范围。')
    case 'invalid': throw new HttpError(400, '作答含有不属于这份试卷的题目或选项。')
    default: throw new HttpError(409, '试卷已在其他设备更新，请刷新后继续。')
  }
}
