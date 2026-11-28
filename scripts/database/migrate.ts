import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

export async function migrate(client, directory = new URL('../../db/migrations/', import.meta.url)) {
  await client.query('BEGIN')
  try {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('eqb/schema-migrations'))")
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        file text PRIMARY KEY,
        sha256 text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `)
    const { rows } = await client.query('SELECT file, sha256 FROM schema_migrations')
    const applied = new Map(rows.map(({ file, sha256 }) => [file, sha256]))
    const files = (await readdir(directory)).filter(file => /^\d{3}_[a-z0-9_]+\.sql$/.test(file)).sort()
    const newFiles = []
    for (const file of files) {
      const sql = await readFile(new URL(file, directory), 'utf8')
      const checksum = createHash('sha256').update(sql.replaceAll('\r\n', '\n')).digest('hex')
      if (applied.has(file)) {
        if (applied.get(file) !== checksum) throw new Error(`Applied migration changed: ${file}`)
        continue
      }
      await client.query(sql)
      await client.query('INSERT INTO schema_migrations (file, sha256) VALUES ($1, $2)', [file, checksum])
      newFiles.push(file)
    }
    await client.query('COMMIT')
    return newFiles
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const connectionString = process.env.CONTENT_DATABASE_URL || process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL
  if (!connectionString) throw new Error('Set DATABASE_URL_UNPOOLED in the migration environment.')
  const client = new pg.Client({ connectionString })
  await client.connect()
  try {
    const files = await migrate(client)
    console.log(files.length ? files.join('\n') : 'Schema is up to date.')
  } finally {
    await client.end()
  }
}
