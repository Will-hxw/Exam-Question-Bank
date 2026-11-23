import assert from 'node:assert/strict'
import { test } from 'node:test'
import { requestJson } from '../../src/features/study/api.ts'

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
