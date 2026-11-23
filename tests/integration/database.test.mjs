import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { after, before, test } from 'node:test'
import { readFile } from 'node:fs/promises'
import pg from 'pg'
import { migrate } from '../../scripts/database/migrate.mjs'
import { reviewFixture, seedQuestions } from './fixture.mjs'

const testUrl = process.env.TEST_DATABASE_URL
if (!testUrl) throw new Error('Set TEST_DATABASE_URL to a development PostgreSQL cluster with CREATEDB permission.')

const admin = new pg.Client({ connectionString: testUrl })
const databaseName = `eqb_test_${randomBytes(8).toString('hex')}`
const isolatedUrl = new URL(testUrl)
isolatedUrl.pathname = '/' + databaseName
const pool = new pg.Pool({ connectionString: isolatedUrl.href, max: 8 })
let questions
let created = false

before(async () => {
  await admin.connect()
  await admin.query(`CREATE DATABASE ${databaseName}`)
  created = true
  const client = await pool.connect()
  try {
    assert.ok((await migrate(client)).length >= 4)
    assert.deepEqual(await migrate(client), [])
    await client.query('BEGIN')
    const topics = JSON.parse(await readFile(new URL('../../content/topics.json', import.meta.url), 'utf8'))
    for (const [position, { id, name, scopeNote, active }] of topics.entries()) {
      await client.query('INSERT INTO topics (id, name, scope_note, sort_order, active) VALUES ($1, $2, $3, $4, $5)',
        [id, name, scopeNote, position + 1, active])
    }
    questions = await seedQuestions(client)
    await client.query('COMMIT')
  } finally {
    client.release()
  }
})

after(async () => {
  await pool.end()
  if (created) await admin.query(`DROP DATABASE ${databaseName}`)
  await admin.end()
})

test('14 approved topics load in the requested order', async () => {
  const { rows } = await pool.query('SELECT id FROM topics ORDER BY sort_order')
  assert.deepEqual(rows.map(({ id }) => id), [
    't01', 't13', 't06', 't07', 't08', 't02', 't14', 't03', 't05', 't11', 't09', 't04', 't10', 't12',
  ])
})

test('publication requires matching separate reviews and locks approved content', async () => {
  const item = questions[0]
  await assert.rejects(pool.query("UPDATE questions SET status = 'published' WHERE id = $1", [item.id]), /two separate matching reviews/)
  await reviewFixture(pool, item)
  await pool.query("UPDATE question_options SET rationale = '修改后需要重审' WHERE question_id = $1 AND id = $2", [item.id, item.correct])
  await assert.rejects(pool.query("UPDATE questions SET status = 'approved' WHERE id = $1", [item.id]), /two separate matching reviews/)
  await pool.query('DELETE FROM question_reviews WHERE question_id = $1', [item.id])
  for (const question of questions) {
    await reviewFixture(pool, question)
    await pool.query("UPDATE questions SET status = 'published' WHERE id = $1", [question.id])
  }
  await assert.rejects(pool.query('DELETE FROM question_answers WHERE question_id = $1', [item.id]), /Return the question to review/)
  await assert.rejects(pool.query("UPDATE questions SET stem = '修改' WHERE id = $1", [item.id]), /Return the question to review/)
  const { rows: [{ count }] } = await pool.query("SELECT count(*)::int FROM questions WHERE status = 'published'")
  assert.equal(count, 52)
})

test('same practice event is counted once during concurrent retries and wrong flags require two correct answers', async () => {
  const [item] = questions
  const event = { eventId: randomUUID(), questionId: item.id, optionIds: [item.wrong] }
  const record = (owner, entry) => pool.query('SELECT record_practice_batch($1, $2) AS results', [owner, JSON.stringify([entry])])
  const progress = async owner => (await pool.query(
    'SELECT attempt_count, is_wrong FROM question_progress WHERE user_id = $1 AND question_id = $2',
    [owner, item.id],
  )).rows[0]
  const results = await Promise.all(Array.from({ length: 8 }, () => record('practice-a', event)))
  for (const result of results) assert.equal(result.rows[0].results[0].status, 'saved')
  assert.deepEqual(await progress('practice-a'), { attempt_count: 1, is_wrong: true })
  assert.equal(await progress('practice-b'), undefined)
  const conflict = await record('practice-a', { ...event, optionIds: [item.correct] })
  assert.equal(conflict.rows[0].results[0].status, 'conflict')
  await record('practice-a', { ...event, eventId: randomUUID(), optionIds: [item.correct] })
  assert.deepEqual(await progress('practice-a'), { attempt_count: 2, is_wrong: true })
  await record('practice-a', { ...event, eventId: randomUUID(), optionIds: [item.correct] })
  assert.deepEqual(await progress('practice-a'), { attempt_count: 3, is_wrong: false })
})

test('50-item exam retains option IDs, rejects other owners and stale drafts, and grades retries once', async () => {
  const selected = questions.slice(0, 50)
  const ids = selected.map(({ id }) => id)
  const starts = await Promise.all(Array.from({ length: 4 }, () => pool.query(
    'SELECT start_exam($1, $2) AS id', ['exam-a', ids],
  )))
  const id = starts[0].rows[0].id
  assert.ok(id)
  assert.ok(starts.every(result => result.rows[0].id === id))
  const responses = { [selected[0].id]: [selected[0].correct], [selected[1].id]: [selected[1].wrong] }
  const update = async (owner, revision, answers, submit) => (await pool.query(
    'SELECT update_exam($1, $2, $3, 1, $4, $5, $6) AS status',
    [owner, id, revision, [selected[0].id], JSON.stringify(answers), submit],
  )).rows[0].status
  assert.equal(await update('exam-b', 0, responses, false), 'missing')
  assert.equal(await update('exam-a', 0, { [selected[0].id]: [selected[1].correct] }, false), 'invalid')
  assert.equal(await update('exam-a', 0, responses, false), 'ok')
  assert.equal(await update('exam-a', 0, responses, false), 'stale')
  assert.deepEqual(await Promise.all([update('exam-a', 1, responses, true), update('exam-a', 1, responses, true)]), ['ok', 'ok'])
  const { rows: [session] } = await pool.query('SELECT score, status, revision FROM exam_sessions WHERE id = $1', [id])
  assert.deepEqual(session, { score: 1, status: 'submitted', revision: 2 })
  const { rows: [{ count }] } = await pool.query("SELECT count(*)::int FROM attempts WHERE user_id = 'exam-a'")
  assert.equal(count, 50)
})
