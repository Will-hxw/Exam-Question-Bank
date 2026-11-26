import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

export async function checkAuthorDirectory(call, db, author, student) {
  const path = '/api/author-chat'
  const directory = `${path}?inbox=1&directory=1`
  await call(directory, { ...student, status: 403 })
  const initial = (await call(directory, author)).data.conversations
  assert.ok(initial.every(({ userId, id, preview, sentAt }) => userId !== author.owner && id === null && preview === null && sentAt === null))
  const guest = initial.find(({ peer }) => peer.email === 'browser@example.test')
  assert.ok(guest)
  const nickname = (await call(`${directory}&q=${encodeURIComponent(guest.peer.nickname)}`, author)).data
  assert.ok(nickname.conversations.some(({ userId }) => userId === guest.userId))
  const byEmail = (await call(`${directory}&q=UNVERIFIED%40`, author)).data.conversations
  assert.deepEqual(byEmail.map(({ peer }) => peer.email), ['unverified@example.test'])
  assert.deepEqual((await call(`${directory}&unread=1`, author)).data.conversations, [])
  assert.equal((await db.query('SELECT count(*)::int AS count FROM author_conversations')).rows[0].count, 0)

  await db.query(`
    INSERT INTO neon_auth."user" (id,email,"emailVerified")
    SELECT 'directory-' || i, 'directory-' || i || '@example.test', true FROM generate_series(1,33) i
  `)
  const first = (await call(directory, author)).data
  assert.equal(first.conversations.length, 30)
  assert.ok(first.nextCursor.startsWith('0:'))
  const second = (await call(`${directory}&before=${encodeURIComponent(first.nextCursor)}`, author)).data
  assert.equal(second.nextCursor, null)
  assert.equal(new Set([...first.conversations, ...second.conversations].map(({ userId }) => userId)).size, initial.length + 33)

  const contact = `${path}?contact=${student.owner}`
  await call(contact, { ...student, method: 'POST', status: 403 })
  const [one, two] = await Promise.all([call(contact, { ...author, method: 'POST' }), call(contact, { ...author, method: 'POST' })])
  assert.equal(one.data.conversationId, two.data.conversationId)
  assert.deepEqual(one.data.messages, [])
  const thread = `${path}?thread=${one.data.conversationId}`
  const text = '作者先来打个招呼'
  await call(thread, { ...author, method: 'POST', body: { clientId: randomUUID(), message: text } })
  assert.deepEqual((await call(`${path}?mine=1`, student)).data.messages.map(({ body }) => body), [text])
  const opens = await Promise.all([call(path, { ...student, method: 'POST' }), call(path, { ...student, method: 'POST' })])
  for (const result of opens) {
    assert.deepEqual(result.data.messages.map(({ body }) => body), [text, '你好，感谢使用，欢迎分享，请问有什么问题吗？'])
  }
  await db.query('DELETE FROM author_conversations')
  await db.query("DELETE FROM neon_auth.\"user\" WHERE id LIKE 'directory-%'")
}
