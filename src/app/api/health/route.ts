import { query } from '@/server/db'
import { route } from '@/server/http'

export const GET = route(async () => {
  await query('SELECT 1')
  return { ok: true }
})
