import { setTimeout as wait } from 'node:timers/promises'
import { parseTriggerDelivery } from '@neon/functions/triggers'

const endpoint = 'https://cqu.xiaoweihua.cn/api/internal/signup-followup'
const scheduleName = 'signup-followup-even-hours'
const probeName = 'signup-followup-probe'

const scheduler = {
  async fetch(request) {
    if (request.method !== 'POST') return new Response(null, { status: 405 })
    const parsed = await parseTriggerDelivery(request)
    if (!parsed.ok) return new Response(null, { status: parsed.error === 'invalid_body' ? 400 : 401 })

    const { invocation } = parsed
    const path = new URL(request.url).pathname
    const probe = path === '/probe' && invocation.trigger.name === probeName
    if (invocation.type !== 'schedule' || (!probe && (path !== '/' || invocation.trigger.name !== scheduleName))) {
      return new Response(null, { status: 404 })
    }

    const token = process.env.EQB_FOLLOWUP_SCHEDULER_TOKEN
    if (!token) return new Response(null, { status: 503 })
    const authorization = 'Bearer ' + token

    try {
      if (probe) {
        const response = await fetch(endpoint, {
          method: 'HEAD', headers: { authorization }, redirect: 'error', signal: AbortSignal.timeout(15000),
        })
        if (!response.ok) throw new Error('Probe rejected')
        console.log(JSON.stringify({ operation: 'signup_followup_probe', ok: true }))
        return Response.json({ ok: true })
      }

      const scheduledAt = new Date(invocation.data.scheduledAt).toISOString()
      let sent = 0
      for (let batch = 0; batch < 10; batch++) {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { authorization, 'x-eqb-scheduled-at': scheduledAt },
          redirect: 'error',
          signal: AbortSignal.timeout(28000),
        })
        if (!response.ok) throw new Error('Scheduled delivery rejected')
        const result = await response.json()
        if (!Number.isInteger(result?.sent) || result.sent < 0 || typeof result.more !== 'boolean') {
          throw new Error('Unexpected delivery result')
        }
        sent += result.sent
        if (!result.more) {
          const summary = { operation: 'signup_followup_schedule', scheduledAt, sent, complete: true }
          console.log(JSON.stringify(summary))
          return Response.json(summary)
        }
        if (batch < 9) await wait(4000)
      }
      console.error(JSON.stringify({ operation: 'signup_followup_schedule', scheduledAt, sent, complete: false }))
      return new Response(null, { status: 503 })
    } catch {
      console.error(JSON.stringify({ operation: 'signup_followup_schedule', probe, complete: false }))
      return new Response(null, { status: 503 })
    }
  },
}

export default scheduler
