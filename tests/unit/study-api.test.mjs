import assert from 'node:assert/strict'
import { test } from 'node:test'
import { requestJson } from '../../src/features/study/api.ts'
import { feedbackMail } from '../../src/features/auth/feedback-template.ts'
import { initialUndonePosition, stepUndonePosition } from '../../src/features/study/practice-undone.ts'
import { addPracticeBookmark, findPracticeBookmark, practiceHistoryLimit, restorePracticeHistory } from '../../src/features/study/practice-history.ts'

test('unattempted navigation keeps original positions and follows the seeded random order', () => {
  const remaining = [{ id: 'a', position: 1 }, { id: 'd', position: 4 }, { id: 'g', position: 7 }]
  assert.equal(initialUndonePosition(remaining, 2), 4)
  assert.equal(stepUndonePosition(remaining, { id: 'z', position: 9 }, 'next'), 1)
  assert.equal(stepUndonePosition(remaining, { id: 'f', position: 6 }, 'previous'), 4)
  assert.equal(initialUndonePosition(remaining, null, 'c'), 4)
  assert.equal(stepUndonePosition(remaining, { id: 'f', position: 6 }, 'next', 'c'), 7)
  assert.equal(stepUndonePosition(remaining, { id: 'g', position: 7 }, 'next', 'c'), 1)
  assert.equal(stepUndonePosition(remaining, { id: 'd', position: 4 }, 'previous', 'c'), null)
})

test('recent practice bookmarks keep the previous round and cap the number of entries', () => {
  let history = restorePracticeHistory(undefined, { position: 0 })
  for (let position = 1; position <= practiceHistoryLimit; position++) {
    history = addPracticeBookmark(history, { position }, 'next')
  }
  history = addPracticeBookmark(history, { position: 0 }, 'next')
  assert.equal(history.entries.length, practiceHistoryLimit)
  const previous = findPracticeBookmark(history, 'previous', () => true)
  assert.equal(history.entries[previous].position, practiceHistoryLimit)
  assert.equal(history.entries[findPracticeBookmark(history, 'previous', (entry) => entry.position < 10)].position, 9)
})

test('feedback mail derives the reply address and allows a rating without a comment', () => {
  const email = 'student@example.test'
  const ratingOnly = feedbackMail('夯', '', email)
  assert.deepEqual(ratingOnly.replyTo, { name: '', address: email })
  assert.equal(ratingOnly.subject, '【练习站意见反馈】夯')
  assert.equal(ratingOnly.text, `整体评价：夯\n注册邮箱：${email}`)
  assert.equal(feedbackMail('夯', '这个题和学院练习不一样。', email).text,
    ratingOnly.text + '\n\n意见或建议：\n这个题和学院练习不一样。')
})

test('protected previews retry public reads with the browser access cookie', async (t) => {
  const calls = []
  t.mock.method(globalThis, 'fetch', async (path, options) => {
    calls.push([path, options.credentials, options.cache])
    if (path === '/api/me/stats' || path === '/api/public/denied') {
      return Response.json({ error: '认证已过期' }, { status: 401 })
    }
    if (path === '/bank/manifest.json' && options.credentials === 'omit') {
      return new Response('Access Restricted', { status: 401, headers: { 'Content-Type': 'text/html' } })
    }
    return Response.json({ ok: true })
  })

  await assert.rejects(requestJson('/api/public/denied'), { message: '认证已过期' })
  assert.deepEqual(await requestJson('/bank/manifest.json', { cache: 'no-cache' }), { ok: true })
  assert.deepEqual(await requestJson('/api/public/topics'), { ok: true })
  await assert.rejects(requestJson('/api/me/stats'), { message: '认证已过期' })

  assert.deepEqual(calls, [
    ['/api/public/denied', 'omit', 'default'],
    ['/bank/manifest.json', 'omit', 'no-cache'],
    ['/bank/manifest.json', 'same-origin', 'no-store'],
    ['/api/public/topics', 'same-origin', 'no-store'],
    ['/api/me/stats', 'same-origin', 'no-store'],
  ])
})
