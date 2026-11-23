import 'server-only'
import { neon, type NeonQueryFunction } from '@neondatabase/serverless'
import { Pool } from 'pg'

let localPool: Pool | undefined
let neonClient: NeonQueryFunction<false, false> | undefined

export async function query<Row>(text: string, values: readonly unknown[] = []): Promise<Row[]> {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) throw new Error('Missing DATABASE_URL')

  const url = new URL(connectionString)
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
  if (loopback) {
    localPool ??= new Pool({ connectionString, connectionTimeoutMillis: 1500, statement_timeout: 4000, max: 5 })
    const result = await localPool.query(text, [...values])
    return result.rows as Row[]
  }

  neonClient ??= neon(connectionString, { fetchOptions: { cache: 'no-store' } })
  return await neonClient.query(text, [...values], { fetchOptions: { signal: AbortSignal.timeout(7500) } }) as Row[]
}
