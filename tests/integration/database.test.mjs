import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { copyFile, mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { after, before, test } from 'node:test'
import { pathToFileURL } from 'node:url'
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
const countMigration = '007_exam_question_count.sql'
const consistencyMigration = '010_exam_wrong_book_consistency.sql'
const followupMigration = '011_signup_followup_email.sql'
const shuffleMigration = '017_shuffle_exam_replays.sql'

async function migrateBefore(client, boundary) {
  const migrations = new URL('../../db/migrations/', import.meta.url)
  const prior = await mkdtemp(join(tmpdir(), 'eqb-migrations-'))
  try {
    const directory = pathToFileURL(prior + sep)
    const files = (await readdir(migrations)).filter(file => /^\d{3}_[a-z0-9_]+\.sql$/.test(file) && file < boundary)
    await Promise.all(files.map(file => copyFile(new URL(file, migrations), new URL(file, directory))))
    return await migrate(client, directory)
  } finally {
    await rm(prior, { recursive: true, force: true })
  }
}

before(async () => {
  await admin.connect()
  await admin.query(`CREATE DATABASE ${databaseName}`)
  created = true
  const client = await pool.connect()
  try {
    assert.ok((await migrateBefore(client, countMigration)).includes('006_exams.sql'))
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

test('legacy practice retries are idempotent before the wrong-book migration', async () => {
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

test('migration preserves an in-progress 50-question draft and submitted exam snapshots', async () => {
  const selected = questions.slice(0, 50)
  const ids = selected.map(({ id }) => id)
  const marks = [ids[49]]
  const answers = JSON.stringify({ [ids[49]]: [selected[49].correct] })
  for (const [owner, submit] of [['legacy-draft', false], ['legacy-submitted', true]]) {
    const { rows: [{ id }] } = await pool.query('SELECT start_exam($1, $2) AS id', [owner, ids])
    const { rows: [{ status }] } = await pool.query('SELECT update_exam($1, $2, 0, 49, $3, $4, $5) AS status',
      [owner, id, marks, answers, submit])
    assert.equal(status, 'ok')
  }
  const existing = `SELECT s.*, (SELECT jsonb_agg(i ORDER BY i.position) FROM exam_items i WHERE i.exam_id = s.id) AS items
    FROM exam_sessions s WHERE s.user_id IN ('legacy-draft', 'legacy-submitted') ORDER BY s.user_id`
  const { rows: prior } = await pool.query(existing)
  const client = await pool.connect()
  try {
    assert.ok((await migrateBefore(client, consistencyMigration)).includes(countMigration))
  } finally {
    client.release()
  }
  const { rows: migrated } = await pool.query(existing)
  assert.deepEqual(migrated, prior.map(row => ({ ...row, question_count: 50, replay_of: null })))
  assert.deepEqual(migrated.map(({ items }) => items.map(({ question_id }) => question_id)), [ids, ids])
  const { rows: [{ status }] } = await pool.query('SELECT update_exam($1, $2, 1, 49, $3, $4, true) AS status',
    ['legacy-draft', prior[0].id, marks, answers])
  assert.equal(status, 'ok')
})

test('migration restores omitted exam items while preserving a later manual removal', async () => {
  const owner = 'omitted-exam-fixture'
  const [untouched, removed, practiced] = questions
  for (const [item, selection] of [[removed, removed.wrong], [practiced, practiced.correct]]) {
    await pool.query('SELECT record_practice_batch($1,$2)', [owner, JSON.stringify([
      { eventId: randomUUID(), questionId: item.id, optionIds: [selection] },
    ])])
  }
  const { rows: [{ id }] } = await pool.query('SELECT start_exam($1,$2) AS id', [owner, [untouched.id, removed.id, practiced.id]])
  const submit = "SELECT update_exam($1,$2,0,0,ARRAY[]::uuid[],'{}',true) AS status"
  assert.equal((await pool.query(submit, [owner, id])).rows[0].status, 'ok')
  const attempts = () => pool.query("SELECT question_id, selection, correct FROM attempts WHERE user_id=$1 AND mode='exam'", [owner])
  assert.equal((await attempts()).rowCount, 0)
  await pool.query('UPDATE question_progress SET is_wrong=false, updated_at=clock_timestamp() WHERE user_id=$1 AND question_id=$2', [owner, removed.id])
  const client = await pool.connect()
  try {
    assert.deepEqual(await migrateBefore(client, followupMigration), [consistencyMigration])
    assert.deepEqual(await migrateBefore(client, followupMigration), [])
  } finally {
    client.release()
  }
  const progress = async ({ id: itemId }) => (await pool.query(
    'SELECT attempt_count, is_wrong FROM question_progress WHERE user_id=$1 AND question_id=$2', [owner, itemId],
  )).rows[0]
  assert.deepEqual(await progress(untouched), { attempt_count: 1, is_wrong: true })
  assert.deepEqual(await progress(removed), { attempt_count: 1, is_wrong: false })
  assert.deepEqual(await progress(practiced), { attempt_count: 2, is_wrong: true })
  const { rows } = await attempts()
  assert.deepEqual(new Set(rows.map(row => row.question_id)), new Set([untouched.id, practiced.id]))
  assert.ok(rows.every(row => row.correct === false && row.selection.length === 0))
  assert.equal((await pool.query(submit, [owner, id])).rows[0].status, 'ok')
  assert.equal((await attempts()).rowCount, 2)
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

test('first practice and every wrong exam pin a question until manual removal', async () => {
  const owner = 'new-wrong-rules'
  const [first, second, skipped] = questions
  const practice = ({ id }, option) => pool.query('SELECT record_practice_batch($1, $2) AS results', [
    owner, JSON.stringify([{ eventId: randomUUID(), questionId: id, optionIds: [option] }]),
  ])
  const state = async ({ id }) => (await pool.query(
    'SELECT attempt_count, is_wrong FROM question_progress WHERE user_id=$1 AND question_id=$2', [owner, id],
  )).rows[0]
  const remove = ({ id }) => pool.query('UPDATE question_progress SET is_wrong=false WHERE user_id=$1 AND question_id=$2', [owner, id])
  await practice(first, first.correct)
  await practice(first, first.wrong)
  assert.deepEqual(await state(first), { attempt_count: 2, is_wrong: false })
  await practice(second, second.wrong)
  await practice(second, second.correct)
  await practice(second, second.correct)
  assert.deepEqual(await state(second), { attempt_count: 3, is_wrong: true })
  await remove(second)
  await practice(second, second.wrong)
  assert.equal((await state(second)).is_wrong, false)

  async function examWith(option) {
    const { rows: [{ id }] } = await pool.query('SELECT start_exam($1,$2) AS id', [owner, [first.id, skipped.id]])
    const sql = 'SELECT update_exam($1,$2,0,0,ARRAY[]::uuid[],$3,true) AS status'
    const args = [owner, id, JSON.stringify({ [first.id]: [option] })]
    assert.equal((await pool.query(sql, args)).rows[0].status, 'ok')
    assert.equal((await pool.query(sql, args)).rows[0].status, 'ok')
  }
  await examWith(first.wrong)
  await examWith(first.correct)
  assert.deepEqual(await state(first), { attempt_count: 4, is_wrong: true })
  await remove(first)
  assert.equal((await state(first)).is_wrong, false)
  await examWith(first.wrong)
  assert.deepEqual(await state(first), { attempt_count: 5, is_wrong: true })
  assert.deepEqual(await state(skipped), { attempt_count: 3, is_wrong: true })
})

test('52-item exams support the last position and scores beyond 50 without changing the snapshot', async () => {
  const ids = questions.map(({ id }) => id)
  const answers = JSON.stringify(Object.fromEntries(questions.map(({ id, correct }) => [id, [correct]])))
  const { rows: [{ id }] } = await pool.query('SELECT start_exam($1, $2) AS id', ['exam-52', ids])
  assert.ok(id)
  assert.equal((await pool.query('SELECT start_exam($1, $2) AS id', ['exam-52', ids.slice(0, 1)])).rows[0].id, id)
  const { rows: [{ ordered }] } = await pool.query(
    'SELECT array_agg(question_id ORDER BY position) AS ordered FROM exam_items WHERE exam_id = $1', [id])
  assert.deepEqual(ordered, ids)

  const update = async (position, revision, submit) => (await pool.query(
    'SELECT update_exam($1, $2, $3, $4, $5, $6, $7) AS status',
    ['exam-52', id, revision, position, ids, answers, submit],
  )).rows[0].status
  assert.equal(await update(52, 0, false), 'invalid_position')
  assert.equal(await update(51, 0, false), 'ok')
  assert.equal(await update(51, 1, true), 'ok')
  assert.equal(await update(51, 1, true), 'ok')
  const { rows: [session] } = await pool.query('SELECT question_count, score, status, revision, position FROM exam_sessions WHERE id = $1', [id])
  assert.deepEqual(session, { question_count: 52, score: 52, status: 'submitted', revision: 2, position: 51 })
  const { rows: [{ count }] } = await pool.query("SELECT count(*)::int FROM attempts WHERE user_id = 'exam-52'")
  assert.equal(count, 52)
})

test('follow-up claims new accounts once after 24 hours or 61 actual answers', async () => {
  const client = await pool.connect()
  try {
    assert.deepEqual(await migrateBefore(client, '012'), [followupMigration])
  } finally {
    client.release()
  }

  await pool.query(`
    CREATE SCHEMA neon_auth;
    CREATE TABLE neon_auth."user" (
      id text PRIMARY KEY, email text NOT NULL, "emailVerified" boolean NOT NULL, "createdAt" timestamptz NOT NULL
    );
    UPDATE schema_migrations SET applied_at = now() - interval '2 days' WHERE file = '011_signup_followup_email.sql';
    INSERT INTO neon_auth."user" VALUES
      ('followup-old', 'old@example.test', true, now() - interval '3 days'),
      ('followup-aged', 'aged@example.test', true, now() - interval '24 hours 1 minute'),
      ('followup-unverified', 'unverified@example.test', false, now() - interval '25 hours'),
      ('followup-young', 'young@example.test', true, now() - interval '1 hour');
  `)

  const claim = async () => (await pool.query('SELECT * FROM claim_signup_followup()')).rows
  assert.deepEqual(await claim(), [])
  await pool.query(`
    UPDATE signup_followup_deliveries SET verified_at = now() - interval '24 hours 1 minute'
    WHERE user_id = 'followup-aged'
  `)
  const competing = await Promise.all(Array.from({ length: 8 }, claim))
  assert.deepEqual(competing.flat(), [{ user_id: 'followup-aged', email: 'aged@example.test', attempts: 1 }])
  assert.deepEqual(await claim(), [])

  const [question] = questions
  await pool.query("INSERT INTO profiles (user_id) VALUES ('followup-young')")
  await pool.query(`
    INSERT INTO attempts (user_id, event_id, question_id, selection, correct, mode)
      SELECT 'followup-young', gen_random_uuid(), $1, ARRAY[$2::uuid], true, 'practice' FROM generate_series(1, 60)
  `, [question.id, question.correct])
  await pool.query(`
    INSERT INTO attempts (user_id, event_id, question_id, selection, correct, mode)
      VALUES ('followup-young', gen_random_uuid(), $1, '{}', false, 'exam')
  `, [question.id])
  assert.deepEqual(await claim(), [])
  await pool.query(`
    INSERT INTO attempts (user_id, event_id, question_id, selection, correct, mode)
      VALUES ('followup-young', gen_random_uuid(), $1, ARRAY[$2::uuid], true, 'exam')
  `, [question.id, question.correct])
  assert.deepEqual(await claim(), [{ user_id: 'followup-young', email: 'young@example.test', attempts: 1 }])

  await pool.query(`
    UPDATE signup_followup_deliveries SET state = 'sent' WHERE user_id = 'followup-aged';
    UPDATE signup_followup_deliveries
      SET state = 'retryable', failure = 'smtp_auth', retry_at = now() + interval '1 hour'
      WHERE user_id = 'followup-young';
  `)
  assert.deepEqual(await claim(), [])
  await pool.query(`
    UPDATE signup_followup_deliveries
      SET retry_at = now() - interval '1 minute', updated_at = now() - interval '1 hour 1 minute'
      WHERE user_id = 'followup-young'
  `)
  assert.deepEqual(await claim(), [{ user_id: 'followup-young', email: 'young@example.test', attempts: 2 }])
  await pool.query("UPDATE signup_followup_deliveries SET state = 'uncertain' WHERE user_id = 'followup-young'")
  assert.deepEqual(await claim(), [])
})

test('follow-up enrolls accounts in the launch gap after verification without resetting delivery state', async () => {
  const client = await pool.connect()
  try {
    assert.ok((await migrateBefore(client, shuffleMigration)).includes('016_signup_followup_launch_gap.sql'))
  } finally {
    client.release()
  }

  await pool.query(`
    UPDATE schema_migrations SET applied_at = '2026-11-25 10:44:47.782+00'
    WHERE file = '011_signup_followup_email.sql';
    INSERT INTO neon_auth."user" VALUES
      ('gap-before', 'before@example.test', true, '2026-11-25 10:21:19.762899+00'),
      ('gap-start', 'start@example.test', true, '2026-11-25 10:21:19.7629+00'),
      ('gap-unverified', 'verify@example.test', false, '2026-11-25 10:42:00+00'),
      ('gap-end', 'after@example.test', true, '2026-11-25 10:44:47.782+00');
    SELECT enqueue_signup_followups();
  `)
  const enrollments = async () => (await pool.query(`
    SELECT user_id, state, attempts FROM signup_followup_deliveries
    WHERE user_id LIKE 'gap-%' ORDER BY user_id
  `)).rows
  assert.deepEqual(await enrollments(), [
    { user_id: 'gap-end', state: 'waiting', attempts: 0 },
    { user_id: 'gap-start', state: 'waiting', attempts: 0 },
  ])
  await pool.query(`
    UPDATE signup_followup_deliveries SET state = 'sent', attempts = 1 WHERE user_id = 'gap-start';
    UPDATE neon_auth."user" SET "emailVerified" = true WHERE id = 'gap-unverified';
    SELECT * FROM claim_signup_followup();
  `)
  assert.deepEqual(await enrollments(), [
    { user_id: 'gap-end', state: 'waiting', attempts: 0 },
    { user_id: 'gap-start', state: 'sent', attempts: 1 },
    { user_id: 'gap-unverified', state: 'waiting', attempts: 0 },
  ])
})

test('replay migration preserves existing drafts and shuffles new replays at the smallest paper sizes', async () => {
  const owner = 'exam-replay-migration'
  const ids = questions.slice(0, 2).map(({ id }) => id)
  const start = async (items) => (await pool.query('SELECT start_exam($1, $2) AS id', [owner, items])).rows[0].id
  const replay = async (source) => (await pool.query('SELECT exam_id FROM replay_exam($1, $2)', [owner, source])).rows[0].exam_id
  const order = async (id) => (await pool.query(
    'SELECT array_agg(question_id ORDER BY position) AS ordered FROM exam_items WHERE exam_id = $1', [id],
  )).rows[0].ordered
  const submit = async (id) => assert.equal((await pool.query(
    "SELECT update_exam($1, $2, 0, 0, '{}'::uuid[], '{}'::jsonb, true) AS status", [owner, id],
  )).rows[0].status, 'ok')

  const source = await start(ids)
  await submit(source)
  const legacyDraft = await replay(source)
  assert.deepEqual(await order(legacyDraft), ids)
  const client = await pool.connect()
  try {
    assert.equal((await migrate(client))[0], shuffleMigration)
  } finally {
    client.release()
  }

  assert.equal(await replay(source), legacyDraft)
  assert.deepEqual(await order(legacyDraft), ids)
  await submit(legacyDraft)

  const shuffled = await replay(source)
  assert.notEqual(shuffled, legacyDraft)
  assert.deepEqual(await order(shuffled), [ids[1], ids[0]])
  await submit(shuffled)
  const replayOfReplay = await replay(shuffled)
  assert.deepEqual(await order(replayOfReplay), ids)
  assert.deepEqual(await order(source), ids)
  await submit(replayOfReplay)

  const single = await start(ids.slice(0, 1))
  await submit(single)
  const singleReplay = await replay(single)
  assert.notEqual(singleReplay, single)
  assert.deepEqual(await order(singleReplay), ids.slice(0, 1))
})

test('retirement clears live state, preserves grades, and excludes the retired item from new replays', async () => {
  const owner = 'retired-exam-questions'
  const [removed, kept] = questions.slice(3, 5)
  const query = async (sql, params) => (await pool.query(sql, params)).rows[0]
  const start = async () => (await query('SELECT start_exam($1,$2) AS id', [owner, [removed.id, kept.id]])).id
  const submit = async (id) => (await query(
    "SELECT update_exam($1,$2,0,0,'{}'::uuid[],$3,true) AS status",
    [owner, id, JSON.stringify({ [removed.id]: [removed.correct], [kept.id]: [kept.correct] })],
  )).status
  const source = await start()
  assert.equal(await submit(source), 'ok')
  assert.equal((await query('SELECT set_favorite($1,$2,true) AS ok', [owner, removed.id])).ok, true)
  const draft = await start()
  const reserved = await query('SELECT position FROM question_bank_positions WHERE question_id=$1', [removed.id])
  assert.ok(reserved.position > 0)
  await pool.query("UPDATE questions SET status='quarantined' WHERE id=$1", [removed.id])
  assert.equal(await query('SELECT 1 FROM active_bank_questions WHERE id=$1', [removed.id]), undefined)
  assert.equal(await query('SELECT 1 FROM favorites WHERE user_id=$1 AND question_id=$2', [owner, removed.id]), undefined)
  assert.equal(await query('SELECT 1 FROM question_progress WHERE user_id=$1 AND question_id=$2', [owner, removed.id]), undefined)
  assert.equal(await submit(draft), 'ok')
  assert.equal((await query('SELECT score FROM exam_sessions WHERE id=$1', [draft])).score, 2)
  assert.equal((await query('SELECT count(*)::int AS total FROM attempts WHERE user_id=$1 AND question_id=$2', [owner, removed.id])).total, 1)
  assert.deepEqual(await query('SELECT position FROM question_bank_positions WHERE question_id=$1', [removed.id]), reserved)
  assert.equal((await query('SELECT exam_snapshot($1,$2) AS exam', [owner, source])).exam.items.length, 2)
  const replay = await query('SELECT exam_id, outcome FROM replay_exam($1,$2)', [owner, source])
  assert.equal(replay.outcome, 'ok')
  const snapshot = (await query('SELECT exam_snapshot($1,$2) AS exam', [owner, replay.exam_id])).exam
  assert.deepEqual(snapshot.items.map(({ id }) => id), [kept.id])
})
