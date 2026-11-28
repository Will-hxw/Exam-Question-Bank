import assert from 'node:assert/strict'
import { test } from 'node:test'
import { requestJson } from '../../src/features/study/api.ts'
import { feedbackMail } from '../../src/features/auth/feedback-template.ts'
import { initialUndonePosition, stepUndonePosition } from '../../src/features/study/practice-undone.ts'
import { addPracticeBookmark, findPracticeBookmark, practiceHistoryLimit, restorePracticeHistory } from '../../src/features/study/practice-history.ts'

test('rolling practice history keeps 50 bookmarks and preserves skipped entries for unfiltered backtracking', () => {
  let history = restorePracticeHistory(null, { position: 0 })
  for (let position = 1; position <= 70; position++) {
    history = addPracticeBookmark(history, { position }, 'next')
  }
  assert.equal(history.entries.length, practiceHistoryLimit)
  assert.equal(history.entries[0].position, 21)
  assert.equal(history.entries[history.cursor].position, 70)
  const filtered = findPracticeBookmark(history, 'previous', ({ position }) => position < 67)
  assert.equal(history.entries[filtered].position, 66)
  const afterToggle = findPracticeBookmark({ ...history, cursor: filtered }, 'next', () => true)
  assert.equal(history.entries[afterToggle].position, 67)
  const restored = restorePracticeHistory(JSON.parse(JSON.stringify(history)), { position: 70 })
  assert.deepEqual(restored, history)
  const changedOnAnotherDevice = restorePracticeHistory({ ...history, cursor: filtered }, { position: 14 })
  assert.equal(changedOnAnotherDevice.entries.at(-2).position, 70)
  assert.equal(changedOnAnotherDevice.entries[changedOnAnotherDevice.cursor].position, 14)
  const jump = addPracticeBookmark({ ...history, cursor: filtered }, { position: 14 }, 'jump')
  assert.equal(jump.entries[jump.cursor - 1].position, 66)
  assert.equal(jump.entries.at(-1).position, 14)
  assert.ok(jump.entries.length <= practiceHistoryLimit)
})

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

test('the static bank is used only for the active database release', async (t) => {
  const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  Object.defineProperty(globalThis, 'window', { configurable: true, value: new EventTarget() })
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: true } })
  t.after(() => {
    if (windowDescriptor) Object.defineProperty(globalThis, 'window', windowDescriptor)
    else delete globalThis.window
    Object.defineProperty(globalThis, 'navigator', navigatorDescriptor)
  })

  const activeRelease = 'a'.repeat(64)
  const staticTopics = [{ id: 't01', name: '静态题库', count: 1 }]
  const databaseTopics = [{ id: 't01', name: '数据库题库', count: 2 }]
  const group = { total: 1, pages: ['/bank/pages/' + 'b'.repeat(64) + '.json'] }
  let staticRelease = 'c'.repeat(64)
  const paths = []
  t.mock.method(globalThis, 'fetch', async (path) => {
    paths.push(path)
    if (path === '/bank/manifest.json') return Response.json({
      release: staticRelease, topics: staticTopics, pageSize: 15, groups: { _all: group, t01: group },
    })
    if (path === '/api/public/bank-release') return Response.json({ release: activeRelease })
    if (path === '/api/public/topics') return Response.json({ topics: databaseTopics })
    throw new Error('Unexpected request ' + path)
  })

  const stale = await import('../../src/features/study/api.ts?bank-release-mismatch')
  assert.deepEqual(await stale.readPublic('/api/public/topics'), { topics: databaseTopics })
  assert.deepEqual(paths, ['/bank/manifest.json', '/api/public/bank-release', '/api/public/topics'])

  staticRelease = activeRelease
  paths.length = 0
  const matching = await import('../../src/features/study/api.ts?bank-release-match')
  assert.deepEqual(await matching.readPublic('/api/public/topics'), { topics: staticTopics })
  assert.deepEqual(paths, ['/bank/manifest.json', '/api/public/bank-release'])
})
