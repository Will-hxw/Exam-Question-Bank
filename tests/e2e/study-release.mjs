import assert from 'node:assert/strict'

export async function checkRetiredQuestion(call, db, id) {
  const stats = (await call('/api/me/stats', { user: 'alice' })).data
  for (const [field, status] of [['attempted', 'done'], ['wrong', 'wrong'], ['favorites', 'favorite']]) {
    const visible = (await call(`/api/me/questions?status=${status}`, { user: 'alice' })).data
    assert.equal(visible.total, stats[field])
    assert.ok(visible.questions.every((question) => question.id !== id))
  }
  const state = (await call(`/api/me/question-state?ids=${id}`, { user: 'alice' })).data.states
  assert.deepEqual(state, {})
  assert.equal((await db.query('SELECT 1 FROM question_progress WHERE question_id=$1', [id])).rowCount, 0)
  assert.equal((await db.query('SELECT 1 FROM favorites WHERE question_id=$1', [id])).rowCount, 0)
  assert.ok((await db.query('SELECT 1 FROM attempts WHERE question_id=$1', [id])).rowCount > 0)
}

export async function checkBankOrder(call, db) {
  const unranked = (await db.query("SELECT id FROM questions WHERE status='published' ORDER BY id")).rows.map(({ id }) => id)
  const ordered = [...unranked.slice(1), unranked[0]]
  await db.query(`
    INSERT INTO question_bank_positions (question_id, position)
    SELECT id, position FROM unnest($1::uuid[]) WITH ORDINALITY AS pinned(id, position)
  `, [ordered])
  try {
    const tail = (await call('/api/public/questions?offset=49&limit=2')).data
    assert.deepEqual(tail.questions.map(({ id }) => id), ordered.slice(-2))
    const afterCursor = (await call(`/api/public/questions?cursor=${ordered[48]}&limit=2`)).data
    assert.deepEqual(afterCursor.questions.map(({ id }) => id), ordered.slice(-2))
    const { positions } = (await call('/api/me/practice-undone', { user: 'conflict' })).data
    assert.deepEqual(positions.at(-1), { id: unranked[0], position: 50 })
  } finally {
    await db.query('DELETE FROM question_bank_positions')
  }
}
