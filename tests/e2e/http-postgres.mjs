import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { cp, mkdir, mkdtemp, readFile, realpath, rm, symlink } from 'node:fs/promises'
import { createServer } from 'node:http'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as sleep } from 'node:timers/promises'
import pg from 'pg'
import { migrate } from '../../scripts/database/migrate.mjs'
import { reviewFixture, seedQuestions } from '../integration/fixture.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const testUrl = process.env.TEST_DATABASE_URL && new URL(process.env.TEST_DATABASE_URL)
if (!testUrl || !['localhost', '127.0.0.1', '[::1]'].includes(testUrl.hostname)) {
  throw new Error('Set TEST_DATABASE_URL to a loopback PostgreSQL test cluster with CREATEDB.')
}
const tokenCookie = '__Secure-neon-auth.session_token'
const users = new Map([
  ['alice', { id: 'e2e-alice', email: 'alice@example.test', emailVerified: true }],
  ['bob', { id: 'e2e-bob', email: 'bob@example.test', emailVerified: true }],
  ['browser', { id: 'e2e-browser', email: 'browser@example.test', emailVerified: true }],
  ['unverified', { id: 'e2e-unverified', email: 'unverified@example.test', emailVerified: false }],
])

function authFixture() {
  function authData(token) {
    const user = users.get(token)
    if (!user) return null
    const now = new Date().toISOString()
    return {
      user: { ...user, name: '测试账号', createdAt: now, updatedAt: now },
      session: { id: `session-${token}`, userId: user.id, token, expiresAt: new Date(Date.now() + 3_600_000).toISOString(), createdAt: now, updatedAt: now },
    }
  }

  return createServer(async (request, response) => {
    const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
    response.setHeader('content-type', 'application/json')
    if (request.method === 'GET' && path === '/auth/get-session') {
      const cookies = (request.headers.cookie ?? '').split(';').map((part) => part.trim())
      const token = cookies.find((part) => part.startsWith(`${tokenCookie}=`))?.slice(tokenCookie.length + 1)
      response.end(JSON.stringify(authData(token)))
      return
    }
    if (request.method === 'POST' && path === '/auth/sign-in/email') {
      const chunks = []
      for await (const chunk of request) chunks.push(chunk)
      const { email, password } = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      const token = [...users].find(([, user]) => user.email === email)?.[0]
      const data = password === 'local-fixture-only' ? authData(token) : null
      if (!data) {
        response.statusCode = 401
        response.end('{"code":"INVALID_EMAIL_OR_PASSWORD"}')
        return
      }
      response.setHeader('set-cookie', `${tokenCookie}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict`)
      response.end(JSON.stringify({ user: data.user, token, redirect: false }))
      return
    }
    response.statusCode = 404
    response.end('{}')
  })
}

async function listen(server) {
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  return server.address().port
}

async function unusedPort() {
  const holder = createServer()
  const port = await listen(holder)
  holder.close()
  await once(holder, 'close')
  return port
}

function run(executable, args, options) {
  return new Promise((done, reject) => {
    const child = spawn(executable, args, { ...options, stdio: 'inherit', windowsHide: true })
    child.once('error', reject)
    child.once('exit', (code) => code === 0 ? done() : reject(new Error(`${basename(executable)} exited ${code}`)))
  })
}

async function waitForHttp(origin) {
  const deadline = Date.now() + 20_000
  do {
    try {
      const reply = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(1200) })
      if (reply.ok && (await reply.json()).ok) return
    } catch { /* Next may still be starting. */ }
    await sleep(150)
  } while (Date.now() < deadline)
  throw new Error('Isolated Next production HTTP server did not become ready.')
}

async function seedDatabase(client) {
  await migrate(client)
  const topics = JSON.parse(await readFile(join(root, 'content', 'topics.json'), 'utf8'))
  for (const [position, { id, name, scopeNote, active }] of topics.entries()) {
    await client.query('INSERT INTO topics (id, name, scope_note, sort_order, active) VALUES ($1,$2,$3,$4,$5)',
      [id, name, scopeNote, position + 1, active])
  }
  const items = await seedQuestions(client)
  for (const item of items) {
    await reviewFixture(client, item)
    await client.query("UPDATE questions SET status = 'published' WHERE id = $1", [item.id])
  }
  return items
}

function percentile(values, fraction) {
  return [...values].sort((a, b) => a - b)[Math.ceil(values.length * fraction) - 1]
}

async function runApiChecks(origin, db, items, secret) {
  const samples = {}
  async function call(path, { method = 'GET', status = 200, user, owner, body, bearer, metric, redirect = 'error' } = {}) {
    const headers = {}
    if (method !== 'GET') headers.origin = origin
    if (owner) headers['x-study-account'] = owner
    if (user) headers.cookie = `${tokenCookie}=${user}`
    if (body !== undefined) headers['content-type'] = 'application/json'
    if (bearer) headers.authorization = `Bearer ${bearer}`
    const start = performance.now()
    const response = await fetch(origin + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect, signal: AbortSignal.timeout(10_000) })
    const payload = await response.text()
    const elapsed = performance.now() - start
    assert.equal(response.status, status, `${method} ${path} ${payload.slice(0, 140)}`)
    if (!path.startsWith('/api/')) return { response }
    if (!path.startsWith('/api/public/') || status >= 400) assert.match(response.headers.get('cache-control') ?? '', /private, no-store/)
    else assert.match(response.headers.get('cache-control') ?? '', /^public,/)
    if (metric) (samples[metric] ??= []).push({ ms: elapsed, bodyBytes: Buffer.byteLength(payload) })
    return { response, data: JSON.parse(payload) }
  }

  const { response: anonymous } = await call('/', { status: 307, redirect: 'manual' })
  assert.equal(anonymous.headers.get('location'), '/login')
  const anonymousSession = await call('/api/me/session')
  assert.equal(anonymousSession.data.user, null)
  await call('/api/me/stats', { status: 401 })
  await call('/api/me/stats', { status: 401, user: 'unverified' })
  for (const identity of ['alice', 'bob']) {
    const login = await call('/api/auth/sign-in/email', { method: 'POST', body: { email: users.get(identity).email, password: 'local-fixture-only' }, metric: 'loginWithSyntheticProvider' })
    assert.equal(login.data.user.id, users.get(identity).id)
    assert.match(login.response.headers.get('set-cookie') ?? '', new RegExp(`${tokenCookie}=${identity}`))
    assert.equal((await call('/api/me/session', { user: identity })).data.user.id, users.get(identity).id)
  }

  const topicsPath = '/api/public/topics'
  const bankPath = '/api/public/questions?topic=t01&limit=15&mode=practice'
  const initialTopics = (await call(topicsPath, { metric: 'topicsCold' })).data.topics
  assert.equal(initialTopics.length, 14)
  const initialPage = (await call(bankPath, { metric: 'practicePageCold' })).data
  assert.equal(initialPage.questions.length, 15)
  assert.equal(initialPage.total, 26)
  const first = initialPage.questions[0]
  assert.match(first.explanation, /总解析测试/)
  assert.ok(first.options.every((option) => option.rationale))
  assert.equal(first.sources[0].title, '测试资料')
  assert.ok(first.answerIds.includes(items.find((item) => item.id === first.id).correct))
  const viewPath = `/api/public/questions/${first.id}/explanation`
  const explanation = (await call(viewPath, { metric: 'explanationCold' })).data
  assert.deepEqual(explanation.answerIds, first.answerIds)

  const searchPath = `/api/public/questions?type=single&limit=7&q=${encodeURIComponent('分层练习')}`
  const searchPage = (await call(searchPath, { metric: 'searchFirst' })).data
  assert.equal(searchPage.total, 52)
  assert.equal(searchPage.questions.length, 7)
  assert.ok(searchPage.questions.every((item) => item.stem.includes('分层练习') && !Object.hasOwn(item, 'answerIds')))
  const secondPage = (await call(`${searchPath}&cursor=${searchPage.nextCursor}`)).data
  assert.equal(secondPage.questions.length, 7)
  assert.equal(secondPage.total, 52)
  assert.equal(new Set([...searchPage.questions, ...secondPage.questions].map(({ id }) => id)).size, 14)
  await call(`${searchPath}&cursor=${searchPage.nextCursor}&offset=0`, { status: 400 })
  assert.equal((await call('/api/public/questions?limit=15&q=%25')).data.total, 0)

  const alice = users.get('alice').id
  const attemptPath = '/api/attempts/batch'
  const firstFixture = items.find((item) => item.id === first.id)
  const attempt = { eventId: randomUUID(), mode: 'practice', questionId: first.id, optionIds: [firstFixture.wrong], contentRevision: first.contentRevision ?? undefined }
  const events = { ownerId: alice, events: [attempt] }
  await call(attemptPath, { method: 'POST', user: 'bob', owner: alice, body: events, status: 409 })
  const writeOptions = { method: 'POST', user: 'alice', owner: alice, body: events, metric: 'attemptWithSyntheticProvider' }
  const results = await Promise.all(Array.from({ length: 4 }, () => call(attemptPath, writeOptions)))
  assert.ok(results.every(({ data }) => data.results[0].status === 'saved' && data.results[0].correct === false))
  const { rows } = await db.query('SELECT user_id, attempt_count, is_wrong FROM question_progress WHERE question_id=$1', [first.id])
  assert.deepEqual(rows, [{ user_id: alice, attempt_count: 1, is_wrong: true }])
  const revisionMismatch = await call(attemptPath, { ...writeOptions, body: { ownerId: alice, events: [{ ...attempt, eventId: randomUUID(), contentRevision: '0'.repeat(64) }] }, metric: undefined })
  assert.equal(revisionMismatch.data.results[0].status, 'unavailable')
  assert.equal((await db.query('SELECT attempt_count FROM question_progress WHERE user_id=$1 AND question_id=$2', [alice, first.id])).rows[0].attempt_count, 1)
  const favoritePath = `/api/me/favorites/${first.id}`
  await call(favoritePath, { method: 'PUT', user: 'alice', owner: alice, body: { favorite: true } })
  const detailsPath = `/api/me/question-state?ids=${first.id}`
  assert.deepEqual((await call(detailsPath, { user: 'alice' })).data.states[first.id], { attempted: true, isFavorite: true, isWrong: true })
  assert.deepEqual((await call(detailsPath, { user: 'bob' })).data.states[first.id], { attempted: false, isFavorite: false, isWrong: false })
  assert.equal((await call('/api/me/questions?status=favorite', { user: 'alice' })).data.total, 1)
  assert.equal((await call('/api/me/questions?status=favorite', { user: 'bob' })).data.total, 0)
  assert.equal((await call('/api/public/questions?limit=15&mode=practice', { user: 'alice' })).response.headers.get('set-cookie'), null)

  const { data: { exam } } = await call('/api/exams', { method: 'POST', user: 'alice', owner: alice, metric: 'createExamWithSyntheticProvider' })
  assert.equal(exam.items.length, 50)
  assert.equal(new Set(exam.items.map(({ id }) => id)).size, 50)
  assert.equal(exam.items.every((question) => !Object.hasOwn(question, 'answerIds') && !Object.hasOwn(question, 'explanation')), true)
  const examPath = `/api/exams/${exam.id}`
  await call(examPath, { user: 'bob', status: 404 })
  const answerItem = items.find((question) => question.id === exam.items[0].id)
  const draft = { position: 1, revision: exam.revision, marked: [answerItem.id], answers: { [answerItem.id]: [answerItem.correct] } }
  const { data: { exam: saved } } = await call(examPath, { method: 'PUT', user: 'alice', owner: alice, body: draft, metric: 'saveExamWithSyntheticProvider' })
  assert.equal(saved.position, 1)
  assert.deepEqual((await call(examPath, { user: 'alice' })).data.exam.answers, draft.answers)
  await call(examPath, { method: 'PUT', user: 'alice', owner: alice, body: draft, status: 409 })
  const submitOptions = { method: 'POST', user: 'alice', owner: alice, body: { ...draft, revision: saved.revision }, metric: 'submitExamWithSyntheticProvider' }
  const result = (await call(`${examPath}/submit`, submitOptions)).data.exam
  assert.equal(result.status, 'submitted')
  assert.equal(result.score, 1)
  assert.equal(result.correctness[answerItem.id], true)
  assert.ok(result.items[0].answerIds.length)
  assert.equal((await call(`${examPath}/submit`, submitOptions)).data.exam.score, 1)
  const examCount = await db.query("SELECT count(*)::int FROM attempts WHERE user_id=$1 AND mode='exam'", [alice])
  assert.equal(examCount.rows[0].count, 50)

  for (let sample = 0; sample < 30; sample++) {
    await call(topicsPath, { metric: 'topicsWarm' })
    await call(bankPath, { metric: 'practicePageWarm' })
    await call(searchPath, { metric: 'searchWarm' })
    await call(viewPath, { metric: 'explanationWarm' })
    await call('/api/me/session', { user: 'alice', metric: 'sessionWithSyntheticProvider' })
  }

  const newName = '缓存失效验证专题'
  await db.query('UPDATE topics SET name=$1 WHERE id=$2', [newName, 't01'])
  await db.query("UPDATE questions SET status='quarantined' WHERE id=$1", [first.id])
  await call(viewPath, { status: 404 })
  await call('/api/internal/invalidate', { method: 'POST', bearer: 'wrong-token', status: 404 })
  const warmTopics = (await call(topicsPath)).data.topics
  assert.notEqual(warmTopics.find(({ id }) => id === 't01').name, newName)
  assert.ok((await call(bankPath)).data.questions.some(({ id }) => id === first.id))
  const start = performance.now()
  await call('/api/internal/invalidate', { method: 'POST', bearer: secret, metric: 'invalidate' })
  const refreshed = (await call(topicsPath, { metric: 'topicsAfterInvalidate' })).data.topics
  const updatedPage = (await call(bankPath, { metric: 'practiceAfterInvalidate' })).data
  assert.equal(refreshed.find(({ id }) => id === 't01').name, newName)
  assert.equal(refreshed.find(({ id }) => id === 't01').count, 25)
  assert.equal(updatedPage.total, 25)
  assert.equal(updatedPage.questions.some(({ id }) => id === first.id), false)

  return {
    verified: ['anonymous/email verification gate', 'distinct fixture Auth owners', 'private no-store and public cache headers', 'real PostgreSQL and Chinese cursor pagination', 'fixed explanation and answer exposure', 'write idempotency and cross-owner rejection', 'real 50-item exam revision, scoring, and idempotency', 'Next Data Cache hot to changed after authorized invalidation'],
    invalidationToObservableRefreshMs: Number((performance.now() - start).toFixed(2)),
    timingsMs: Object.fromEntries(Object.entries(samples).map(([name, timings]) => {
      const values = timings.map(({ ms }) => ms)
      return [name, { n: values.length, p50: Number(percentile(values, .5).toFixed(2)), p95: Number(percentile(values, .95).toFixed(2)), bodyBytesP50: percentile(timings.map(({ bodyBytes }) => bodyBytes), .5) }]
    })),
  }
}

const auth = authFixture()
const admin = new pg.Client({ connectionString: testUrl.toString() })
const databaseName = `eqb_http_${randomBytes(8).toString('hex')}`
const databaseUrl = new URL(testUrl)
databaseUrl.pathname = '/' + databaseName
const db = new pg.Client({ connectionString: databaseUrl.toString() })
const tmp = resolve(root, 'tmp')
let created = false
let server
let buildDir

try {
  await admin.connect()
  await admin.query(`CREATE DATABASE ${databaseName}`)
  created = true
  await db.connect()
  const items = await seedDatabase(db)
  const { rows: [{ server_version: postgres }] } = await db.query('SHOW server_version')

  await mkdir(tmp, { recursive: true })
  buildDir = await mkdtemp(join(tmp, 'eqb-http-'))
  const projectFiles = ['src', 'next.config.ts', 'tsconfig.json', 'package.json', 'package-lock.json', 'public']
  await Promise.all(projectFiles.map((file) => cp(join(root, file), join(buildDir, file), {
    recursive: true,
    filter: (source) => source !== join(root, 'public', 'bank'),
  })))
  await symlink(join(root, 'node_modules'), join(buildDir, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
  const next = join(buildDir, 'node_modules', 'next', 'dist', 'bin', 'next')
  const port = await unusedPort()
  const authPort = await listen(auth)
  const origin = `http://127.0.0.1:${port}`
  const secret = randomBytes(32).toString('hex')
  const env = { ...process.env, DATABASE_URL: databaseUrl.toString(), NEON_AUTH_BASE_URL: `http://127.0.0.1:${authPort}/auth`,
    NEON_AUTH_COOKIE_SECRET: randomBytes(32).toString('hex'), CONTENT_INVALIDATION_SECRET: secret,
    NEXT_PUBLIC_SITE_URL: origin, NEON_OTP_WEBHOOK_ENABLED: 'false', NEXT_TELEMETRY_DISABLED: '1' }
  await run(process.execPath, [next, 'build', '--webpack'], { cwd: buildDir, env })
  server = spawn(process.execPath, [next, 'start', '--hostname', '127.0.0.1', '--port', String(port)], { cwd: buildDir, env, stdio: 'inherit', windowsHide: true })
  await waitForHttp(origin)
  const result = await runApiChecks(origin, db, items, secret)
  console.log(JSON.stringify({ environment: { app: 'Next production build', node: process.version, postgres, network: 'loopback', auth: 'synthetic upstream' }, ...result }, null, 2))
  if (process.env.EQB_TEST_BROWSER === '1') {
    await run(process.env.EQB_TEST_PYTHON || 'python', [join(root, 'tests', 'e2e', 'study-browser.py')], {
      cwd: root,
      env: { ...process.env, EQB_TEST_ORIGIN: origin, EQB_TEST_COOKIE_NAME: tokenCookie, EQB_TEST_COOKIE_TOKEN: 'browser', PYTHONUTF8: '1' },
    })
    const browserWrites = await db.query("SELECT mode, count(*)::int AS count FROM attempts WHERE user_id=$1 GROUP BY mode ORDER BY mode", [users.get('browser').id])
    assert.deepEqual(browserWrites.rows, [{ mode: 'exam', count: 50 }, { mode: 'practice', count: 1 }])
  }
} finally {
  if (server && server.exitCode === null) {
    const exit = once(server, 'exit')
    server.kill()
    await exit
  }
  if (auth.listening) {
    auth.close()
    await once(auth, 'close')
  }
  await db.end()
  if (created) await admin.query(`DROP DATABASE ${databaseName} WITH (FORCE)`)
  await admin.end()
  if (buildDir) {
    const checked = await realpath(buildDir)
    const knownParent = await realpath(tmp)
    if (dirname(checked) !== knownParent || !basename(checked).startsWith('eqb-http-') || !checked.startsWith(knownParent + sep)) {
      throw new Error('Unexpected isolated build path; refusing cleanup.')
    }
    await rm(join(checked, 'node_modules'), { force: true })
    await rm(checked, { recursive: true, force: true })
  }
}
