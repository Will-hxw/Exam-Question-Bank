import assert from 'node:assert/strict'
import { test } from 'node:test'
import scheduler from '../../functions/signup-followup/index.mjs'

const makeRequest = (name, path, headers = {}) => new Request('https://scheduler.example.test' + path, {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...headers },
  body: JSON.stringify({
    version: 1,
    invocation_id: 'test-invocation',
    trigger: { type: 'schedule', id: 'trigger-test', name },
    data: { scheduled_at: '2026-11-26T14:00:00Z' },
  }),
})

test('Neon signup follow-up validates the trigger and calls the existing mail endpoint', async (t) => {
  const token = 'test-scheduler-token'
  const previous = process.env.EQB_FOLLOWUP_SCHEDULER_TOKEN
  process.env.EQB_FOLLOWUP_SCHEDULER_TOKEN = token
  t.after(() => {
    if (previous === undefined) delete process.env.EQB_FOLLOWUP_SCHEDULER_TOKEN
    else process.env.EQB_FOLLOWUP_SCHEDULER_TOKEN = previous
  })
  const calls = []
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, ...options })
    return Response.json({ sent: 2, more: false })
  })

  const valid = { 'x-neon-trigger-invocation-id': 'test-invocation' }
  assert.equal((await scheduler.fetch(makeRequest('signup-followup-even-hours', '/'))).status, 401)
  assert.equal((await scheduler.fetch(makeRequest('signup-followup-even-hours', '/', {
    'x-neon-trigger-invocation-id': 'different-invocation',
  }))).status, 401)
  assert.equal((await scheduler.fetch(makeRequest('unexpected-trigger', '/', valid))).status, 404)
  assert.equal(calls.length, 0)

  const response = await scheduler.fetch(makeRequest('signup-followup-even-hours', '/', valid))
  assert.equal(response.status, 200)
  assert.equal((await response.json()).sent, 2)
  assert.equal(calls[0].method, 'POST')
  assert.equal(calls[0].headers.authorization, 'Bearer ' + token)
  assert.equal(calls[0].headers['x-eqb-scheduled-at'], '2026-11-26T14:00:00.000Z')

  assert.equal((await scheduler.fetch(makeRequest('signup-followup-probe', '/probe', valid))).status, 200)
  assert.equal(calls[1].method, 'HEAD')
})
