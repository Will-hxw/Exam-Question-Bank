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
import { checkAuthorDirectory, seedUnreadInbox } from './author-directory.mjs'
import { checkBankOrder, checkRetiredQuestion } from './study-release.mjs'

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
  ['undone', { id: 'e2e-undone', email: 'undone@example.test', emailVerified: true }],
  ['personal-library', { id: 'e2e-personal-library', email: 'personal-library@example.test', emailVerified: true }],
  ['conflict', { id: 'e2e-conflict', email: 'conflict@example.test', emailVerified: true }],
  ['rejection', { id: 'e2e-rejection', email: 'rejection@example.test', emailVerified: true }],
  ...['recovery', 'touch', 'mobile-actions', 'source-links', 'history-pages'].map(token => [
    token, { id: `e2e-${token}`, email: `${token}@example.test`, emailVerified: true },
  ]),
  ['receipt', { id: 'e2e-receipt', email: 'receipt@example.test', emailVerified: true }],
  ['author', { id: 'e2e-author', email: 'xiaoweihuacqu@gmail.com', emailVerified: true }],
  ['unverified', { id: 'e2e-unverified', email: 'unverified@example.test', emailVerified: false }],
])
const modelCalls = []
const proactiveCalls = []
const simulatedReply = '记得啊，春天嘛'
const simulatedIdentity = '真啊，不然我咋从网线里游过来的喵'
const followUpQuestion = '？ 还能看图像？'
const simulatedFollowUp = '我能看见你这张头像呀，还以为你在考本鱼呢'

function modelInput(call) {
  const { content } = call.messages.at(-1)
  return JSON.parse(typeof content === 'string' ? content : content.find(({ type }) => type === 'text').text)
}

function authFixture(db) {
  const signupEmail = 'browser-signup@example.test'
  const signupToken = 'browser-signup'
  let signup
  let signupPassword
  let verificationCode
  let resetCode
  function authData(token) {
    const user = token === signupToken ? signup : users.get(token)
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
    if (request.method !== 'POST') {
      response.statusCode = 404
      response.end('{}')
      return
    }
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const input = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}
    if (path === '/deepseek/v1/chat/completions') {
      if (request.headers.authorization !== 'Bearer local-completions-fixture') {
        response.statusCode = 401
        response.end('{}')
        return
      }
      const { latest } = modelInput(input)
      if (input.messages[0].content.includes('这轮群里没人明确')) {
        proactiveCalls.push(input)
        const decision = latest === '群聊没点名，肥鱼来接一下这个梗'
          ? { reply: '这个梗本鱼接住了', mention: true } : { reply: '' }
        response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(decision) } }] }))
        return
      }
      modelCalls.push(input)
      if (latest === '接口故障演练') {
        response.statusCode = 502
        response.end('{}')
        return
      }
      const continuing = input.messages[0].content.includes('对方正在接你刚回给他的那句话')
      if (continuing && latest === followUpQuestion) {
        response.end(JSON.stringify({ choices: [{ message: { content: simulatedFollowUp } }] }))
        return
      }
      if (continuing && latest === '我不信你还会接梗') {
        response.end(JSON.stringify({ choices: [{ message: { content: '不信是吧，你接着出题嘛' } }] }))
        return
      }
      const retryInstruction = input.messages[0].content.includes('至少五个字')
      const content = latest === '测试短回复'
        ? (retryInstruction ? '刚才走神了一下，你接着说嘛' : '嗯啊')
        : latest.includes('真ai吗') ? simulatedIdentity : simulatedReply
      response.end(JSON.stringify({ choices: [{ message: { content } }] }))
      return
    }
    const { email, password, otp } = input
    const success = (token) => {
      const data = authData(token)
      response.setHeader('set-cookie', `${tokenCookie}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict`)
      response.end(JSON.stringify({ user: data.user, token, redirect: false }))
    }
    const reject = (status, code) => {
      response.statusCode = status
      response.end(JSON.stringify({ code }))
    }
    switch (path) {
      case '/auth/sign-in/email': {
        const token = email === signupEmail ? signupToken : [...users].find(([, user]) => user.email === email)?.[0]
        const expected = token === signupToken ? signupPassword : 'local-fixture-only'
        const data = password === expected ? authData(token) : null
        if (!data) return reject(401, 'INVALID_EMAIL_OR_PASSWORD')
        if (!data.user.emailVerified) return reject(403, 'EMAIL_NOT_VERIFIED')
        return success(token)
      }
      case '/auth/sign-up/email':
        if (email !== signupEmail) return response.end(JSON.stringify({ user: { email, emailVerified: false }, token: null }))
        await db.query('INSERT INTO neon_auth."user" (id,email,"emailVerified") VALUES ($1,$2,false) ON CONFLICT DO NOTHING',
          ['e2e-signup', email])
        signup = { id: 'e2e-signup', email, emailVerified: false }
        signupPassword = password
        verificationCode = '412386'
        return response.end(JSON.stringify({ user: signup, token: null }))
      case '/auth/email-otp/send-verification-otp':
        if (email !== signupEmail || !signup) return reject(400, 'INVALID_EMAIL')
        verificationCode = '732518'
        return response.end('{"success":true}')
      case '/auth/email-otp/verify-email':
        if (email !== signupEmail || !signup || !verificationCode || otp !== verificationCode) return reject(400, 'INVALID_OTP')
        verificationCode = undefined
        signup.emailVerified = true
        await db.query('UPDATE neon_auth."user" SET "emailVerified" = true WHERE id = $1', [signup.id])
        return success(signupToken)
      case '/auth/forget-password/email-otp':
      case '/auth/email-otp/request-password-reset':
        if (email === signupEmail && signup) resetCode = '628154'
        return response.end('{"success":true}')
      case '/auth/email-otp/reset-password':
        if (email !== signupEmail || !signup || !resetCode || otp !== resetCode) return reject(400, 'INVALID_OTP')
        resetCode = undefined
        signupPassword = password
        return response.end('{"success":true}')
      case '/auth/sign-out':
        response.setHeader('set-cookie', `${tokenCookie}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`)
        return response.end('{"success":true}')
      default:
        return reject(404, 'NOT_FOUND')
    }
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
  await client.query('CREATE SCHEMA neon_auth; CREATE TABLE neon_auth."user" (id text PRIMARY KEY, email text UNIQUE, "emailVerified" boolean NOT NULL)')
  for (const { id, email, emailVerified } of users.values()) {
    await client.query('INSERT INTO neon_auth."user" VALUES ($1,$2,$3)', [id, email, emailVerified])
  }
  const topics = JSON.parse(await readFile(join(root, 'content', 'topics.json'), 'utf8'))
  for (const [position, { id, name, scopeNote, active }] of topics.entries()) {
    await client.query('INSERT INTO topics (id, name, scope_note, sort_order, active) VALUES ($1,$2,$3,$4,$5)',
      [id, name, scopeNote, position + 1, active])
  }
  const items = await seedQuestions(client, 52, 50)
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
  async function call(path, { method = 'GET', status = 200, user, owner, body, bearer, metric, redirect = 'error', requestOrigin = origin } = {}) {
    const headers = {}
    if (method !== 'GET') headers.origin = requestOrigin
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
  for (const path of ['/questions', '/exam', '/favorites', '/wrong']) {
    const { response } = await call(path, { status: 307, redirect: 'manual' })
    assert.equal(response.headers.get('location'), '/login?' + new URLSearchParams({ next: path }))
  }
  for (const next of ['https://example.invalid', '//example.invalid', '/api/me/stats', '/login']) {
    const { response } = await call('/login?' + new URLSearchParams({ next }), { user: 'alice', status: 307, redirect: 'manual' })
    assert.equal(response.headers.get('location'), '/')
  }
  const { response: signedIn } = await call('/login?next=%2Fquestions', { user: 'alice', status: 307, redirect: 'manual' })
  assert.equal(signedIn.headers.get('location'), '/questions')
  const { response: accountRedirect } = await call('/account', { status: 307, redirect: 'manual' })
  assert.equal(accountRedirect.headers.get('location'), '/login')
  const anonymousSession = await call('/api/me/session')
  assert.equal(anonymousSession.data.user, null)
  await call('/api/chat', { status: 401 })
  await call('/api/chat', { user: 'unverified', status: 401 })
  await call('/api/me/stats', { status: 401 })
  await call('/api/me/stats', { status: 401, user: 'unverified' })

  const feedbackPath = '/api/feedback'
  const feedback = { method: 'POST', user: 'alice', owner: users.get('alice').id,
    body: { rating: '夯', message: '测试意见' } }
  await call(feedbackPath, { ...feedback, user: undefined, status: 401 })
  await call(feedbackPath, { ...feedback, user: 'unverified', status: 401 })
  await call(feedbackPath, { ...feedback, owner: users.get('bob').id, status: 409 })
  await call(feedbackPath, { ...feedback, requestOrigin: 'https://other.example.test', status: 403 })
  await call(feedbackPath, { ...feedback, body: { ...feedback.body, rating: 5 }, status: 400 })
  await call(feedbackPath, { ...feedback, body: { ...feedback.body, message: '  \n' }, status: 503 })
  await call(feedbackPath, { ...feedback, body: { rating: '夯' }, status: 503 })
  await call(feedbackPath, { ...feedback, body: { ...feedback.body, message: '字'.repeat(1001) }, status: 400 })
  await call(feedbackPath, { ...feedback, body: { ...feedback.body, message: '字'.repeat(3000) }, status: 413 })
  await call(feedbackPath, { ...feedback, status: 503 })

  const failedLogin = (email) => call('/api/auth/sign-in/email', {
    method: 'POST', status: 401, body: { email, password: 'incorrect-fixture-password' },
  })
  assert.equal((await failedLogin('  ALICE@EXAMPLE.TEST  ')).data.code, 'INVALID_PASSWORD')
  assert.equal((await failedLogin('unknown@example.test')).data.code, 'INVALID_EMAIL_OR_PASSWORD')

  const signUp = (email, status) => call('/api/auth/sign-up/email', {
    method: 'POST', status, body: { email, password: 'local-fixture-only' },
  })
  assert.equal((await signUp('  ALICE@EXAMPLE.TEST  ', 409)).data.code, 'EMAIL_ALREADY_REGISTERED')
  assert.equal((await signUp('unverified@example.test', 409)).data.code, 'EMAIL_ALREADY_REGISTERED')
  assert.equal((await signUp('new@example.test', 200)).data.user.email, 'new@example.test')

  const wrongCode = await call('/api/auth/email-otp/verify-email', {
    method: 'POST', status: 400, body: { email: 'new@example.test', otp: '123456' },
  })
  assert.equal(wrongCode.data.code, 'INVALID_OTP')
  for (const identity of ['alice', 'bob']) {
    const login = await call('/api/auth/sign-in/email', { method: 'POST', body: { email: users.get(identity).email, password: 'local-fixture-only' }, metric: 'loginWithSyntheticProvider' })
    assert.equal(login.data.user.id, users.get(identity).id)
    assert.match(login.response.headers.get('set-cookie') ?? '', new RegExp(`${tokenCookie}=${identity}`))
    assert.equal((await call('/api/me/session', { user: identity })).data.user.id, users.get(identity).id)
  }

  const topicsPath = '/api/public/topics'
  const bankPath = '/api/public/questions?topic=t01&limit=15&mode=practice'
  const bankReleasePath = '/api/public/bank-release'
  assert.deepEqual((await call(bankReleasePath)).data, { release: null })
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
  assert.equal(searchPage.total, 51)
  assert.equal(searchPage.questions.length, 7)
  assert.ok(searchPage.questions.every((item) => item.stem.includes('分层练习') && !Object.hasOwn(item, 'answerIds')))
  const secondPage = (await call(`${searchPath}&cursor=${searchPage.nextCursor}`)).data
  assert.equal(secondPage.questions.length, 7)
  assert.equal(secondPage.total, 51)
  assert.equal(new Set([...searchPage.questions, ...secondPage.questions].map(({ id }) => id)).size, 14)
  await call(`${searchPath}&cursor=${searchPage.nextCursor}&offset=0`, { status: 400 })
  assert.equal((await call('/api/public/questions?limit=15&q=%25')).data.total, 0)
  const optionSearch = (await call(`/api/public/questions?limit=7&q=${encodeURIComponent('选项文本 ２')}`)).data
  assert.equal(optionSearch.total, 52)
  assert.ok(optionSearch.questions.every((item) => !item.stem.includes('选项文本') && item.options.some((option) => option.text === '选项文本 2')))
  const seed = randomUUID()
  const shufflePath = `/api/public/questions?limit=15&mode=practice&random=${seed}`
  assert.deepEqual((await call(shufflePath)).data.questions, (await call(shufflePath)).data.questions)

  const alice = users.get('alice').id
  const samplePreferences = { theme: 'dark', practice: { mode: 'topic', topic: 't14' }, 'practice-position:topic:t14': 8,
    'practice-only-undone': true, 'practice-position:random-undone': 21 }
  await call('/api/me/preferences', { method: 'PUT', user: 'alice', owner: alice, body: samplePreferences })
  await call('/api/me/preferences', { method: 'PUT', user: 'alice', owner: alice, body: { unknown: true }, status: 400 })
  await call('/api/me/preferences', { method: 'PUT', user: 'alice', owner: alice, body: { 'practice-only-undone': 'true' }, status: 400 })
  await call('/api/me/preferences', { method: 'PUT', user: 'bob', owner: alice, body: { theme: 'light' }, status: 409 })
  await call('/api/me/stats', { user: 'bob', owner: alice, status: 409 })
  assert.deepEqual((await call('/api/me/stats', { user: 'alice' })).data.preferences, samplePreferences)
  assert.deepEqual((await call('/api/me/stats', { user: 'bob' })).data.preferences, {})
  const libraryKey = 'library:all'
  await call('/api/me/preferences', { method: 'PUT', user: 'alice', owner: alice, body: { [libraryKey]: { type: 'single', page: 0 } } })
  const libraryPatch = await call('/api/me/preferences', {
    method: 'PUT', user: 'alice', owner: alice, body: { [libraryKey]: { limit: 50, page: 0 } },
  })
  assert.deepEqual(libraryPatch.data.preferences[libraryKey], { type: 'single', limit: 50, page: 0 })
  await call('/api/me/preferences', { method: 'PUT', user: 'alice', owner: alice, body: { [libraryKey]: { extra: 'unsupported' } }, status: 400 })
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
  const undonePath = '/api/me/practice-undone?topic=t01'
  await call(undonePath, { status: 401 })
  await call(undonePath + '&topic=t14', { user: 'alice', status: 400 })
  const aliceUndone = (await call(undonePath, { user: 'alice' })).data.positions
  const bobUndone = (await call(undonePath, { user: 'bob' })).data.positions
  assert.equal(bobUndone.length, 26)
  assert.deepEqual(bobUndone[0], { id: first.id, position: 0 })
  assert.deepEqual(aliceUndone, bobUndone.slice(1))
  assert.deepEqual(aliceUndone[0], { id: initialPage.questions[1].id, position: 1 })
  const revisionMismatch = await call(attemptPath, { ...writeOptions, body: { ownerId: alice, events: [{ ...attempt, eventId: randomUUID(), contentRevision: '0'.repeat(64) }] }, metric: undefined })
  assert.equal(revisionMismatch.data.results[0].status, 'unavailable')
  assert.equal((await db.query('SELECT attempt_count FROM question_progress WHERE user_id=$1 AND question_id=$2', [alice, first.id])).rows[0].attempt_count, 1)
  const favoritePath = `/api/me/favorites/${first.id}`
  await call(favoritePath, { method: 'PUT', user: 'alice', owner: alice, body: { favorite: true } })
  const detailsPath = `/api/me/question-state?ids=${first.id}`
  assert.deepEqual((await call(detailsPath, { user: 'alice' })).data.states[first.id], { attempted: true, isFavorite: true, isWrong: true })
  assert.deepEqual((await call(detailsPath, { user: 'bob' })).data.states[first.id], { attempted: false, isFavorite: false, isWrong: false })
  await call(detailsPath, { user: 'bob', owner: alice, status: 409 })
  assert.equal((await call('/api/me/questions?status=favorite', { user: 'alice' })).data.total, 1)
  assert.equal((await call('/api/me/questions?status=favorite', { user: 'bob' })).data.total, 0)
  assert.equal((await call('/api/public/questions?limit=15&mode=practice', { user: 'alice' })).response.headers.get('set-cookie'), null)

  const { data: { exam } } = await call('/api/exams', { method: 'POST', user: 'alice', owner: alice, metric: 'createExamWithSyntheticProvider' })
  assert.equal(exam.items.length, 50)
  assert.equal(exam.total, 50)
  assert.equal(new Set(exam.items.map(({ id }) => id)).size, 50)
  assert.equal(exam.items.every((question) => !Object.hasOwn(question, 'answerIds') && !Object.hasOwn(question, 'explanation')), true)
  const examPath = `/api/exams/${exam.id}`
  await call(examPath, { user: 'bob', status: 404 })
  const answerItem = items.find((question) => question.id === exam.items[0].id)
  const draft = { position: 1, revision: exam.revision, marked: [answerItem.id], answers: { [answerItem.id]: answerItem.answerIds } }
  const { data: { exam: saved } } = await call(examPath, { method: 'PUT', user: 'alice', owner: alice, body: draft, metric: 'saveExamWithSyntheticProvider' })
  assert.equal(saved.position, 1)
  const { exam: resumedSaved } = (await call('/api/exams', { method: 'POST', user: 'alice', owner: alice, body: { questionCount: 8 } })).data
  assert.deepEqual(resumedSaved, saved)
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
  const wrongBookPath = '/api/me/questions?status=wrong&limit=50'
  const wrongBook = (await call(wrongBookPath, { user: 'alice' })).data.questions
  assert.ok(exam.items.slice(1).every(({ id }) => wrongBook.some((item) => item.id === id && item.attempted)))
  assert.equal(new Set(wrongBook.map(({ id }) => id)).size, wrongBook.length)
  await call(`${examPath}/replay`, { method: 'POST', user: 'bob', owner: users.get('bob').id, status: 404 })
  const replayRequests = await Promise.all(Array.from({ length: 2 }, () => call(`${examPath}/replay`, {
    method: 'POST', user: 'alice', owner: alice,
  })))
  const replayed = replayRequests[0].data.exam
  assert.deepEqual(replayRequests[1].data.exam, replayed)
  assert.notEqual(replayed.id, exam.id)
  assert.equal(replayed.total, exam.total)
  assert.notDeepEqual(replayed.items.map(({ id }) => id), exam.items.map(({ id }) => id))
  assert.deepEqual(new Map(replayed.items.map(item => [item.id, item])), new Map(exam.items.map(item => [item.id, item])))
  assert.deepEqual([replayed.answers, replayed.marked, replayed.position, replayed.revision], [{}, [], 0, 0])
  const replayPath = `/api/exams/${replayed.id}`
  const compactSave = await call(`${replayPath}?ack=1`, { method: 'PUT', user: 'alice', owner: alice, body: { ...draft, revision: 0 } })
  assert.deepEqual(compactSave.data, { revision: 1 })
  const resumedReplay = (await call(replayPath, { user: 'alice' })).data.exam
  assert.deepEqual(resumedReplay.items, replayed.items)
  assert.deepEqual([resumedReplay.answers, resumedReplay.marked, resumedReplay.position], [draft.answers, draft.marked, draft.position])
  const replayResult = (await call(`${replayPath}/submit`, { ...submitOptions, metric: undefined })).data.exam
  assert.equal(replayResult.score, 1)
  assert.equal(replayResult.correctness[answerItem.id], true)
  assert.deepEqual(replayResult.items.map(({ id }) => id), replayed.items.map(({ id }) => id))
  assert.deepEqual((await call(examPath, { user: 'alice' })).data.exam, result)

  const bob = users.get('bob').id
  const customStart = { method: 'POST', user: 'bob', owner: bob }
  for (const questionCount of [0, 101, 1.5, '8', null]) {
    await call('/api/exams', { ...customStart, body: { questionCount }, status: 400 })
  }
  await call('/api/exams', { ...customStart, body: { questionCount: 100 }, status: 409 })
  const { exam: large } = (await call('/api/exams', { ...customStart, body: { questionCount: 52 } })).data
  const order = large.items.map(({ id }) => id)
  assert.equal(large.total, 52)
  assert.equal(order.length, 52)
  assert.deepEqual(new Set(order), new Set(items.map(({ id }) => id)))
  const largePath = `/api/exams/${large.id}`
  const largeDraft = {
    position: 51, revision: large.revision, marked: [order[51]],
    answers: Object.fromEntries(items.map(({ id, answerIds }) => [id, answerIds])),
  }
  const largeWrite = { method: 'PUT', user: 'bob', owner: bob }
  await call(largePath, { ...largeWrite, body: { ...largeDraft, position: 52 }, status: 400 })
  const { exam: largeSaved } = (await call(largePath, { ...largeWrite, body: largeDraft })).data
  const { exam: resumed } = (await call('/api/exams', { ...customStart, body: { questionCount: 1 } })).data
  assert.equal(resumed.id, large.id)
  assert.equal(resumed.position, 51)
  assert.deepEqual(resumed.answers, largeDraft.answers)
  assert.deepEqual(resumed.items.map(({ id }) => id), order)
  const { exam: largeResult } = (await call(`${largePath}/submit`, {
    ...largeWrite, method: 'POST', body: { ...largeDraft, revision: largeSaved.revision },
  })).data
  assert.equal(largeResult.score, 52)
  assert.equal(largeResult.items.length, 52)
  assert.ok(largeResult.items.every(({ id, answerIds, explanation }) => largeResult.correctness[id] && answerIds.length && explanation))
  const { exam: rerolled } = (await call('/api/exams', { ...customStart, body: { questionCount: 52 } })).data
  assert.notEqual(rerolled.id, large.id)
  assert.notDeepEqual(rerolled.items.map(({ id }) => id), order)
  await call(`${largePath}/replay`, { ...customStart, status: 409 })
  const { exams: history } = (await call('/api/exams', { user: 'bob' })).data
  assert.deepEqual(history.map(({ id, total, score }) => ({ id, total, score })), [
    { id: rerolled.id, total: 52, score: null }, { id: large.id, total: 52, score: 52 },
  ])
  const historyOwner = users.get('history-pages').id
  await db.query('INSERT INTO profiles (user_id) VALUES ($1)', [historyOwner])
  await db.query(`INSERT INTO exam_sessions (user_id, status, started_at, submitted_at, score, question_count)
    SELECT $1, 'submitted', now(), now(), 0, 1 FROM generate_series(1, 32)`, [historyOwner])
  await db.query('INSERT INTO exam_sessions (user_id) VALUES ($1)', [historyOwner])
  const head = (await call('/api/exams', { user: 'history-pages' })).data
  assert.equal(head.exams.length, 30)
  assert.equal(head.exams[0].status, 'draft')
  assert.equal(head.nextCursor, head.exams[29].id)
  const older = (await call(`/api/exams?before=${head.nextCursor}`, { user: 'history-pages' })).data
  assert.equal(older.exams.length, 3)
  assert.equal(older.nextCursor, null)
  assert.equal(new Set([...head.exams, ...older.exams].map(entry => entry.id)).size, 33)
  const otherOwner = (await call(`/api/exams?before=${head.nextCursor}`, { user: 'bob' })).data
  assert.deepEqual(otherOwner, { exams: [], nextCursor: null })

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
  await checkRetiredQuestion(call, db, first.id)
  await call('/api/internal/invalidate', { method: 'POST', bearer: 'wrong-token', status: 404 })
  const warmTopics = (await call(topicsPath)).data.topics
  assert.notEqual(warmTopics.find(({ id }) => id === 't01').name, newName)
  assert.ok((await call(bankPath)).data.questions.some(({ id }) => id === first.id))
  const nextTestRelease = 'e'.repeat(64)
  await db.query('INSERT INTO content_release (digest) VALUES ($1)', [nextTestRelease])
  const versionDeadline = Date.now() + 25_000
  let liveRelease
  do {
    liveRelease = (await call(bankReleasePath)).data.release
    if (liveRelease !== nextTestRelease) await sleep(400)
  } while (liveRelease !== nextTestRelease && Date.now() < versionDeadline)
  assert.equal(liveRelease, nextTestRelease)
  assert.equal((await call(topicsPath)).data.topics.find(({ id }) => id === 't01').count, 25)
  assert.equal((await call(bankPath)).data.total, 25)

  const start = performance.now()
  await call('/api/internal/invalidate', { method: 'POST', bearer: secret, metric: 'invalidate' })
  assert.deepEqual((await call(bankReleasePath)).data, { release: nextTestRelease })
  const refreshed = (await call(topicsPath, { metric: 'topicsAfterInvalidate' })).data.topics
  const updatedPage = (await call(bankPath, { metric: 'practiceAfterInvalidate' })).data
  assert.equal(refreshed.find(({ id }) => id === 't01').name, newName)
  assert.equal(refreshed.find(({ id }) => id === 't01').count, 25)
  assert.equal(updatedPage.total, 25)
  assert.equal(updatedPage.questions.some(({ id }) => id === first.id), false)

  await checkBankOrder(call, db)

  const chatPath = '/api/chat'
  const chatAlice = { user: 'alice', owner: users.get('alice').id }
  const chatBob = { user: 'bob', owner: users.get('bob').id }
  const sharedStatus = '/api/author-chat?withShared=1'
  const groupReadPath = `${chatPath}/read`
  const markGroupRead = (viewer, through, status = 200) => call(groupReadPath, { ...viewer, method: 'PUT', body: { through }, status })
  assert.deepEqual((await call(sharedStatus, chatBob)).data, { unread: false, sharedUnread: false })
  const initialChat = (await call(chatPath, chatAlice)).data
  assert.deepEqual(initialChat.messages, [])
  assert.equal(initialChat.hasMore, false)
  assert.equal(initialChat.nicknameCursor, '0')
  assert.match(initialChat.profile.authorKey, /^[A-Za-z0-9_-]{43}$/)
  assert.match(initialChat.profile.nickname, /(奶龙|奶娃|噜噜)$/)
  assert.ok(initialChat.profile.avatar >= 0 && initialChat.profile.avatar < 36)
  assert.deepEqual((await call(chatPath, chatAlice)).data.profile, initialChat.profile)
  await call(chatPath, { ...chatAlice, method: 'PUT', body: { nickname: '   ' }, status: 400 })
  await call(chatPath, { ...chatAlice, method: 'PUT', body: { nickname: '新昵称' }, status: 403, requestOrigin: 'http://example.invalid' })
  await call(chatPath, { ...chatAlice, owner: chatBob.owner, method: 'PUT', body: { nickname: '新昵称' }, status: 409 })
  const savedChat = (await call(chatPath, { ...chatAlice, method: 'PUT', body: { nickname: '  测试奶娃  ' } })).data.profile
  assert.ok(BigInt(savedChat.nicknameRevision) > BigInt(initialChat.profile.nicknameRevision))
  assert.deepEqual(savedChat, { ...initialChat.profile, nickname: '测试奶娃', nicknameRevision: savedChat.nicknameRevision })
  assert.deepEqual((await call(chatPath, chatAlice)).data.profile, savedChat)
  const chatWrite = { ...chatAlice, method: 'POST', body: { clientId: randomUUID(), message: '新消息 😀\n第二行' } }
  const [firstSend, replayedSend] = await Promise.all([call(chatPath, chatWrite), call(chatPath, chatWrite)])
  const sentChat = firstSend.data.message
  assert.deepEqual(replayedSend.data.message, sentChat)
  const { clientId: ownClientId, ...sharedMessage } = sentChat
  assert.equal(ownClientId, chatWrite.body.clientId)
  assert.deepEqual(Object.keys(sharedMessage).sort(), ['authorKey', 'avatar', 'body', 'id', 'mine', 'nickname', 'nicknameRevision', 'sentAt'])
  assert.equal(sentChat.authorKey, savedChat.authorKey)
  assert.equal(sentChat.mine, true)
  assert.equal(sentChat.nickname, savedChat.nickname)
  assert.equal(sentChat.body, chatWrite.body.message)
  assert.equal((await call(sharedStatus, chatAlice)).data.sharedUnread, false)
  assert.deepEqual((await call(sharedStatus, chatBob)).data, { unread: false, sharedUnread: true })
  await markGroupRead({}, sentChat.id, 401)
  await markGroupRead(chatAlice, sentChat.id, 404)
  await markGroupRead({ ...chatBob, owner: chatAlice.owner }, sentChat.id, 409)
  await markGroupRead(chatBob, 'abc', 400)
  assert.deepEqual((await markGroupRead(chatBob, sentChat.id)).data, { unread: false })
  assert.deepEqual((await call(sharedStatus, chatBob)).data, { unread: false, sharedUnread: false })
  const inactiveReader = { user: 'browser', owner: users.get('browser').id }
  assert.deepEqual((await markGroupRead(inactiveReader, sentChat.id)).data, { unread: false })
  await call(chatPath, { ...chatWrite, status: 409, body: { ...chatWrite.body, message: '不同的内容' } })
  await call(chatPath, { ...chatWrite, status: 429, body: { ...chatWrite.body, clientId: randomUUID() } })
  await call(chatPath, { ...chatWrite, status: 400, body: { ...chatWrite.body, message: '长'.repeat(501) } })
  assert.deepEqual((await call(`${chatPath}?after=0`, chatBob)).data.messages, [{ ...sharedMessage, mine: false }])
  assert.deepEqual((await call(`${chatPath}?after=${sentChat.id}`, chatBob)).data.messages, [])
  await call(`${chatPath}?before=${sentChat.id}&after=0`, { ...chatBob, status: 400 })
  await call(`${chatPath}?after=9223372036854775808`, { ...chatBob, status: 400 })
  await call(`${chatPath}?after=${sentChat.id}&nicknamesAfter=invalid`, { ...chatBob, status: 400 })
  const beforeRename = (await call(chatPath, chatBob)).data
  const renamed = (await call(chatPath, { ...chatAlice, method: 'PUT', body: { nickname: '改名后的奶龙' } })).data.profile
  const { authorKey, nickname, nicknameRevision } = renamed
  const nicknameUpdate = (await call(`${chatPath}?after=${sentChat.id}&nicknamesAfter=${beforeRename.nicknameCursor}`, chatBob)).data
  assert.deepEqual(nicknameUpdate, {
    messages: [], hasMore: false, nicknames: [{ authorKey, nickname, nicknameRevision }], hasMoreNicknames: false,
  })
  assert.equal(authorKey, sentChat.authorKey)
  assert.ok(BigInt(nicknameRevision) > BigInt(beforeRename.nicknameCursor))
  const updatedMessage = { ...sentChat, nickname, nicknameRevision }
  assert.deepEqual((await call(chatPath, chatBob)).data.messages, [{ ...sharedMessage, nickname, nicknameRevision, mine: false }])
  assert.deepEqual((await call(chatPath, chatWrite)).data.message, updatedMessage)

  const privateProfile = (await call(chatPath, { ...chatBob, method: 'PUT', body: { nickname: '未发言的噜噜' } })).data.profile
  const silentUpdates = `${chatPath}?after=${sentChat.id}&nicknamesAfter=${nicknameRevision}`
  assert.deepEqual((await call(silentUpdates, chatAlice)).data.nicknames, [])
  assert.deepEqual((await call(silentUpdates, chatBob)).data.nicknames, [{
    authorKey: privateProfile.authorKey, nickname: privateProfile.nickname, nicknameRevision: privateProfile.nicknameRevision,
  }])
  await db.query(`
    INSERT INTO chat_messages (user_id, client_id, nickname, avatar, body)
    SELECT $1, gen_random_uuid(), '历史测试', 0, '历史消息 ' || i FROM generate_series(1, 48) i
  `, [chatAlice.owner])
  const latestChat = (await call(chatPath, chatBob)).data
  assert.deepEqual((await markGroupRead(chatBob, sentChat.id)).data, { unread: true })
  await markGroupRead(chatBob, latestChat.messages.at(-1).id)
  assert.deepEqual((await markGroupRead(chatBob, sentChat.id)).data, { unread: false })
  assert.equal(latestChat.messages.length, 40)
  assert.equal(latestChat.hasMore, true)
  const chatHistory = (await call(`${chatPath}?before=${latestChat.messages[0].id}`, chatBob)).data
  assert.equal(chatHistory.messages.length, 9)
  assert.equal(chatHistory.hasMore, false)
  assert.equal(chatHistory.messages[0].id, sentChat.id)
  assert.ok(chatHistory.messages.every(message => message.nickname === nickname && message.authorKey === authorKey))
  const firstUpdates = (await call(`${chatPath}?after=${sentChat.id}`, chatBob)).data
  assert.equal(firstUpdates.messages.length, 40)
  assert.equal(firstUpdates.hasMore, true)
  const rest = (await call(`${chatPath}?after=${firstUpdates.messages.at(-1).id}`, chatBob)).data
  assert.equal(rest.messages.length, 8)
  assert.equal(rest.hasMore, false)
  assert.equal(rest.messages.at(-1).id, latestChat.messages.at(-1).id)

  const avatarImageId = randomUUID()
  const avatarImage = await readFile(join(root, 'public', 'chat-avatars', '0.webp'))
  await db.query('INSERT INTO chat_avatars (user_id, id, image) VALUES ($1, $2, $3)', [chatAlice.owner, avatarImageId, avatarImage])
  const ownProfile = (await call(chatPath, chatAlice)).data.profile
  assert.equal(ownProfile.avatarImageId, avatarImageId)
  assert.equal(ownProfile.nickname, nickname)
  const otherView = (await call(chatPath, chatBob)).data
  assert.equal(otherView.profile.avatarImageId, undefined)
  assert.ok(otherView.messages.every(message => message.avatarImageId === avatarImageId))
  const olderView = (await call(`${chatPath}?before=${otherView.messages[0].id}`, chatBob)).data
  assert.equal(olderView.messages[0].avatarImageId, avatarImageId)
  assert.equal((await call(chatPath, chatWrite)).data.message.avatarImageId, avatarImageId)
  const avatarPath = `${chatPath}/avatar?id=${avatarImageId}`
  await call(avatarPath, { status: 401 })
  const avatarResponse = await fetch(origin + avatarPath, { headers: { cookie: `${tokenCookie}=bob` } })
  assert.equal(avatarResponse.status, 200)
  assert.equal(avatarResponse.headers.get('content-type'), 'image/webp')
  assert.equal(avatarResponse.headers.get('cache-control'), 'private, no-store')
  assert.deepEqual(Buffer.from(await avatarResponse.arrayBuffer()), avatarImage)
  await db.query('DELETE FROM chat_messages WHERE user_id = $1', [chatAlice.owner])
  await call(avatarPath, { ...chatBob, status: 404 })

  const author = { user: 'author', owner: users.get('author').id }
  const authorPath = '/api/author-chat'
  const write = (path, viewer, message) => call(path, { ...viewer, method: 'POST', body: { clientId: randomUUID(), message } })
  const read = (path, viewer, through) => call(path, { ...viewer, method: 'PUT', body: { through } })
  const waitForChat = async (path, viewer, predicate) => {
    const timeout = Date.now() + 6000
    while (Date.now() < timeout) {
      const message = (await call(path, viewer)).data.messages.find(predicate)
      if (message) return message
      await sleep(60)
    }
    assert.fail('Automatic reply never appeared in chat history')
  }
  await call(authorPath, { status: 401 })
  await call(`${authorPath}?inbox=1`, { ...chatAlice, status: 403 })
  await call(`${authorPath}?mine=1`, { ...chatAlice, status: 404 })
  assert.deepEqual((await call(authorPath, chatAlice)).data, { unread: false })
  assert.deepEqual((await call(`${authorPath}?inbox=1`, author)).data.conversations, [])
  assert.equal((await db.query('SELECT count(*)::int AS count FROM author_messages')).rows[0].count, 0)
  await checkAuthorDirectory(call, db, author, chatBob)
  await call(authorPath, { ...author, method: 'POST', status: 403 })
  const [opened, secondOpen] = await Promise.all(Array.from({ length: 2 }, () => call(authorPath, { ...chatAlice, method: 'POST' })))
  assert.equal(opened.data.conversationId, secondOpen.data.conversationId)
  assert.deepEqual(opened.data.messages, secondOpen.data.messages)
  assert.equal(opened.data.messages.length, 1)
  const [welcome] = opened.data.messages
  assert.equal(welcome.body, '你好，感谢使用，欢迎分享，请问有什么问题吗？')
  assert.equal(welcome.nickname, 'Hua Xiaowei')
  assert.equal(opened.data.peer.email, undefined)
  assert.deepEqual((await call(`${authorPath}?mine=1`, chatAlice)).data, opened.data)
  assert.deepEqual((await call(authorPath, chatAlice)).data, { unread: true })
  const thread = `${authorPath}?thread=${opened.data.conversationId}`
  await call(thread, { ...chatBob, status: 404 })
  await call(thread, { ...chatBob, method: 'PUT', body: { through: welcome.id }, status: 404 })
  await call(thread, { ...chatBob, method: 'POST', body: { clientId: randomUUID(), message: '跨账号' }, status: 404 })
  assert.equal((await read(thread, chatAlice, welcome.id)).data.unread, false)
  const manual = (await write(thread, chatAlice, '私信历史标记，注册地址 alice@example.test')).data.message
  assert.equal(manual.mine, true)
  const inbox = (await call(`${authorPath}?inbox=1&unread=1`, author)).data
  assert.equal(inbox.conversations.length, 1)
  assert.equal(inbox.conversations[0].peer.email, 'alice@example.test')
  assert.equal(inbox.conversations[0].preview, manual.body)
  for (const q of ['ALICE@', inbox.conversations[0].peer.nickname.slice(0, 2)]) {
    const match = (await call(`${authorPath}?inbox=1&unread=1&q=${encodeURIComponent(q)}`, author)).data
    assert.deepEqual(match.conversations, inbox.conversations)
  }
  assert.deepEqual((await call(`${authorPath}?inbox=1&q=unknown`, author)).data.conversations, [])
  await call(`${authorPath}?inbox=1&q=alice`, { ...chatBob, status: 403 })
  assert.equal((await call(thread, author)).data.peer.email, 'alice@example.test')
  assert.equal((await read(thread, author, manual.id)).data.unread, false)
  assert.deepEqual((await call(`${authorPath}?inbox=1&unread=1`, author)).data.conversations, [])
  assert.deepEqual((await call(`${authorPath}?inbox=1&unread=1&q=alice`, author)).data.conversations, [])
  const ownerReply = (await write(thread, author, '管理员回复')).data.message
  assert.equal((await read(thread, chatAlice, welcome.id)).data.unread, true)
  assert.equal((await read(thread, chatAlice, ownerReply.id)).data.unread, false)
  const oldDirect = (await call(`${thread}&before=${ownerReply.id}`, chatAlice)).data.messages
  assert.deepEqual(oldDirect.map(({ id }) => id), [welcome.id, manual.id])

  await db.query("UPDATE author_messages SET sent_at = sent_at - interval '5 seconds' WHERE id = $1", [manual.id])
  await db.query(`
    INSERT INTO author_messages (conversation_id, from_author, body)
    SELECT $1, false, '私信上下文样本 ' || i FROM generate_series(1, 16) i
  `, [opened.data.conversationId])
  const privateAsk = (await write(thread, chatAlice, '@Hua Xiaowei 结合私信上一条回答')).data.message
  const privateReply = await waitForChat(thread, chatAlice, (message) => !message.mine && message.body === simulatedReply)
  assert.equal(privateReply.aiReplyTo, privateAsk.id)
  assert.equal(modelCalls.length, 1)
  assert.equal(modelCalls[0].model, 'deepseek-v4.1-flash-1017')
  assert.equal(typeof modelCalls[0].messages.at(-1).content, 'string')
  const directInput = modelInput(modelCalls[0])
  assert.equal(directInput.latest, '结合私信上一条回答')
  assert.equal(directInput.history.length, 19)
  const directContext = JSON.stringify(directInput.history)
  assert.match(directContext, /私信历史标记/)
  assert.match(directContext, /管理员回复/)
  assert.doesNotMatch(directContext, /alice@example\.test/)
  assert.equal((await call(thread, author)).data.messages.find((message) => message.id === privateAsk.id).mine, false)

  await call(chatPath, { ...author, method: 'PUT', body: { nickname: '仿作者' }, status: 403 })
  await call(chatPath, { ...chatBob, method: 'PUT', body: { nickname: 'Hua Xiaowei（作者）' }, status: 400 })
  await call(chatPath, { ...chatBob, method: 'PUT', body: { nickname: '肥鱼 AI（可@）' }, status: 400 })
  await call(chatPath, { ...chatBob, method: 'PUT', body: { nickname: 'AI（可@）' }, status: 400 })
  const longName = '长昵称'.repeat(15)
  assert.equal((await call(chatPath, { ...chatBob, method: 'PUT', body: { nickname: longName } })).data.profile.nickname, longName)
  await call(chatPath, { ...chatBob, method: 'PUT', body: { nickname: longName + '长'.repeat(4) }, status: 400 })
  const ownerPost = (await write(chatPath, author, '作者上线')).data.message
  const { rows: [{ id: ownerAvatarId }] } = await db.query(
    'INSERT INTO chat_avatars (user_id, image) VALUES ($1, $2) RETURNING id::text', [author.owner, avatarImage],
  )
  const { nickname: ownerName, avatarUrl: ownerAvatarUrl, avatarImageId: groupAvatarId } = (await call(chatPath, author)).data.profile
  assert.equal(ownerName, 'AI（可@）')
  assert.match(ownerAvatarUrl, /^\/ui-images\/feiyu\.[a-f0-9]{10}\.webp$/)
  assert.equal(groupAvatarId, undefined)
  const publicAvatar = await fetch(origin + ownerAvatarUrl)
  assert.equal(publicAvatar.status, 200)
  assert.equal(publicAvatar.headers.get('content-type'), 'image/webp')
  assert.deepEqual(Buffer.from(await publicAvatar.arrayBuffer()), await readFile(join(root, 'public', ownerAvatarUrl.slice(1))))
  assert.equal(ownerPost.avatarUrl, ownerAvatarUrl)
  const recent = (await call(chatPath, chatAlice)).data
  const groupOwner = recent.messages.at(-1)
  assert.equal(groupOwner.nickname, ownerName)
  assert.equal(groupOwner.avatarUrl, ownerAvatarUrl)
  assert.equal(groupOwner.avatarImageId, undefined)
  assert.equal(recent.authorAvatar, undefined)
  const privateRoom = (await call(thread, chatAlice)).data
  assert.equal(privateRoom.peer.nickname, 'Hua Xiaowei')
  assert.equal(privateRoom.peer.avatarImageId, ownerAvatarId)
  assert.equal(privateRoom.peer.avatarUrl, undefined)
  assert.deepEqual(Buffer.from(privateRoom.authorAvatar, 'base64'), avatarImage)
  const ownerPrivateAvatar = `${chatPath}/avatar?id=${ownerAvatarId}`
  await call(ownerPrivateAvatar, { ...chatBob, status: 404 })
  assert.equal((await fetch(origin + ownerPrivateAvatar, { headers: { cookie: `${tokenCookie}=alice` } })).status, 200)
  const privateAvatar = `${chatPath}/avatar?id=${avatarImageId}`
  await call(privateAvatar, { ...chatBob, status: 404 })
  assert.equal((await fetch(origin + privateAvatar, { headers: { cookie: `${tokenCookie}=author` } })).status, 200)

  await db.query(`
    INSERT INTO chat_messages (user_id, client_id, nickname, avatar, body, sent_at)
    SELECT $1, gen_random_uuid(), '历史测试', 0, '群聊上下文样本 ' || i, clock_timestamp() - interval '1 minute'
    FROM generate_series(1, 51) i
  `, [chatAlice.owner])
  const groupHint = (await write(chatPath, chatAlice, '这个头像是随机的吗？群聊记住一个词，春天 @AIStudy')).data.message
  await write(chatPath, chatBob, '另一位同学的上下文')
  await db.query("UPDATE chat_messages SET sent_at = sent_at - interval '5 seconds' WHERE id = $1", [groupHint.id])
  const publicWrite = { ...chatAlice, method: 'POST', body: { clientId: randomUUID(), message: '@AI（可@） 刚才那个词是什么？' } }
  const [publicAsk, retryAsk] = await Promise.all([call(chatPath, publicWrite), call(chatPath, publicWrite)])
  assert.equal(publicAsk.data.message.id, retryAsk.data.message.id)
  const publicReply = await waitForChat(chatPath, chatAlice, (message) => message.aiReplyTo === publicAsk.data.message.id)
  assert.equal(publicReply.nickname, ownerName)
  assert.equal(publicReply.avatarUrl, ownerAvatarUrl)
  assert.equal(modelCalls.length, 2)
  const publicInput = modelInput(modelCalls[1])
  assert.equal(publicInput.latest, '刚才那个词是什么？')
  assert.equal(publicInput.history.length, 50)
  assert.equal(publicInput.history[0].content, '群聊上下文样本 3')
  const publicContext = JSON.stringify(publicInput.history)
  assert.match(publicContext, /春天/)
  assert.match(publicContext, /@AIStudy/)
  assert.doesNotMatch(publicContext, /私信历史标记|另一位同学的上下文/)
  await db.query("UPDATE chat_messages SET sent_at = sent_at - interval '5 seconds' WHERE id = $1", [publicAsk.data.message.id])
  const identityAsk = (await write(chatPath, chatAlice, '@肥鱼 AI 真ai吗🤔')).data.message
  const identityReply = await waitForChat(chatPath, chatAlice, (message) => message.aiReplyTo === identityAsk.id)
  assert.equal(identityReply.body, simulatedIdentity)
  const identityInput = modelInput(modelCalls[2])
  assert.equal(identityInput.latest, '真ai吗🤔')
  assert.ok(identityInput.history.some(({ content }) => content.includes('这个头像是随机的吗')))
  await db.query("UPDATE chat_messages SET sent_at = sent_at - interval '5 seconds' WHERE id = $1", [identityAsk.id])
  const providerError = (await write(chatPath, chatAlice, '@作者 接口故障演练')).data.message
  const fallback = await waitForChat(chatPath, chatAlice, (message) => message.aiReplyTo === providerError.id)
  assert.match(fallback.body, /没连上/)
  assert.equal(modelInput(modelCalls[3]).history.at(-1).content, simulatedIdentity)
  await db.query("UPDATE chat_messages SET sent_at = sent_at - interval '5 seconds' WHERE id = $1", [providerError.id])
  const shortAsk = (await write(chatPath, chatAlice, '@作者 测试短回复')).data.message
  const retried = await waitForChat(chatPath, chatAlice, (message) => message.aiReplyTo === shortAsk.id)
  assert.equal(retried.body, '刚才走神了一下，你接着说嘛')
  assert.equal(modelCalls.length, 6)
  assert.deepEqual(modelCalls[4].messages.at(-1).content, modelCalls[5].messages.at(-1).content)
  assert.match(modelCalls[5].messages[0].content, /至少五个字/)
  await db.query(`
    INSERT INTO chat_messages (user_id, client_id, nickname, avatar, body, sent_at)
    SELECT $1, gen_random_uuid(), '历史测试', 0, i || ':' || repeat('长', 495), clock_timestamp() - interval '1 minute'
    FROM generate_series(1, 24) i
  `, [chatAlice.owner])
  const longAsk = (await write(chatPath, chatAlice, '@Hua Xiaowei 测试长上下文')).data.message
  const longReply = await waitForChat(chatPath, chatAlice, (message) => message.aiReplyTo === longAsk.id)
  const longInput = modelInput(modelCalls[6])
  assert.equal(longInput.latest, '测试长上下文')
  assert.equal(longInput.history.length, 16)
  assert.match(longInput.history.at(-1).content, /^24:/)
  assert.ok(Buffer.byteLength(JSON.stringify(longInput.history)) <= 24 * 1024)

  await db.query("UPDATE chat_messages SET sent_at = sent_at - interval '21 seconds' WHERE id IN ($1,$2)", [longAsk.id, longReply.id])
  const followUp = (await write(chatPath, chatAlice, followUpQuestion)).data.message
  const naturalReply = await waitForChat(chatPath, chatAlice, (message) => message.aiReplyTo === followUp.id)
  assert.equal(naturalReply.body, simulatedFollowUp)
  const followUpCall = modelCalls.find((input) => modelInput(input).latest === followUpQuestion)
  assert.ok(followUpCall)
  assert.equal(modelInput(followUpCall).history.at(-1).content, longReply.body)

  await db.query('DELETE FROM chat_ai_requests WHERE proactive')
  await db.query("UPDATE chat_messages SET sent_at = sent_at - interval '5 seconds' WHERE id = $1", [followUp.id])
  await db.query(`
    INSERT INTO chat_messages (user_id, client_id, nickname, avatar, body)
    VALUES ($1, gen_random_uuid(), '群聊同学', 0, '另一位同学的最近发言')
  `, [chatBob.owner])
  const proactivePost = {
    ...chatAlice, method: 'POST', body: { clientId: randomUUID(), message: '群聊没点名，肥鱼来接一下这个梗' },
  }
  const [noMention, retriedPost] = await Promise.all([call(chatPath, proactivePost), call(chatPath, proactivePost)])
  assert.equal(noMention.data.message.id, retriedPost.data.message.id)
  assert.equal(noMention.data.message.clientId, proactivePost.body.clientId)
  const automatic = await waitForChat(chatPath, chatBob, (message) => message.aiReplyTo === noMention.data.message.id)
  assert.equal(automatic.body, `@${noMention.data.message.nickname} 这个梗本鱼接住了`)
  const calls = proactiveCalls.filter((input) => modelInput(input).latest === proactivePost.body.message)
  assert.equal(calls.length, 1)
  assert.equal(modelInput(calls[0]).speaker.nickname, noMention.data.message.nickname)
  assert.match(JSON.stringify(modelInput(calls[0]).history), /另一位同学的最近发言/)
  assert.doesNotMatch(JSON.stringify(modelInput(calls[0]).history), /私信历史标记/)
  const avatarBlock = calls[0].messages.at(-1).content.find(({ type }) => type === 'image_url')
  assert.deepEqual(Buffer.from(avatarBlock.image_url.url.split(',')[1], 'base64'), avatarImage)

  await db.query("UPDATE chat_messages SET sent_at = sent_at - interval '5 seconds' WHERE id = $1", [noMention.data.message.id])
  await db.query('UPDATE chat_ai_requests SET claimed_at = clock_timestamp() WHERE message_id = $1', [noMention.data.message.id])
  const banter = (await write(chatPath, chatAlice, '我不信你还会接梗')).data.message
  const banterReply = await waitForChat(chatPath, chatBob, (message) => message.aiReplyTo === banter.id)
  assert.equal(banterReply.body, '不信是吧，你接着出题嘛')

  await db.query("UPDATE chat_ai_requests SET claimed_at = clock_timestamp() - interval '2 minutes' WHERE proactive")
  await db.query("UPDATE chat_messages SET sent_at = sent_at - interval '5 seconds' WHERE user_id=$1 AND body='另一位同学的最近发言'", [chatBob.owner])
  const bystander = (await write(chatPath, chatBob, followUpQuestion)).data.message
  const deadline = Date.now() + 6000
  while (!proactiveCalls.some((input) => modelInput(input).latest === followUpQuestion) && Date.now() < deadline) await sleep(60)
  assert.equal(proactiveCalls.filter((input) => modelInput(input).latest === followUpQuestion).length, 1)
  assert.equal(modelCalls.filter((input) => modelInput(input).latest === followUpQuestion).length, 1)
  const { rows: [bystanderClaim] } = await db.query(`
    SELECT proactive, EXISTS (SELECT 1 FROM chat_messages WHERE ai_reply_to=$1) AS answered
    FROM chat_ai_requests WHERE message_id=$1
  `, [bystander.id])
  assert.deepEqual(bystanderClaim, { proactive: true, answered: false })
  await db.query('DELETE FROM chat_messages; DELETE FROM author_conversations')

  return {
    verified: ['anonymous/email verification gate', 'distinct fixture Auth owners', 'private no-store and public cache headers', 'real PostgreSQL and Chinese cursor pagination', 'fixed explanation and answer exposure', 'write idempotency and cross-owner rejection', 'default and custom exam size, random order, validation, resume, scoring, and history', 'Next Data Cache hot to changed after authorized invalidation', 'shared chat, stable profiles, rename, cursor pagination, concurrent retry, rate limit and privacy', 'account-specific chat avatars, historical messages and authenticated image delivery', 'private conversation access, concurrent first open, author inbox and unread cursors', 'DeepSeek protocol, bounded history outside the 12-message window, context isolation, concurrent request deduplication and provider error', 'rating-only feedback request validation'],
    invalidationToObservableRefreshMs: Number((performance.now() - start).toFixed(2)),
    timingsMs: Object.fromEntries(Object.entries(samples).map(([name, timings]) => {
      const values = timings.map(({ ms }) => ms)
      return [name, { n: values.length, p50: Number(percentile(values, .5).toFixed(2)), p95: Number(percentile(values, .95).toFixed(2)), bodyBytesP50: percentile(timings.map(({ bodyBytes }) => bodyBytes), .5) }]
    })),
  }
}

const admin = new pg.Client({ connectionString: testUrl.toString() })
const databaseName = `eqb_http_${randomBytes(8).toString('hex')}`
const databaseUrl = new URL(testUrl)
databaseUrl.pathname = '/' + databaseName
const db = new pg.Client({ connectionString: databaseUrl.toString() })
const auth = authFixture(db)
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
  const projectFiles = ['src', 'next.config.ts', 'postcss.config.mjs', 'postcss-unocss.cjs', 'uno.config.ts', 'tsconfig.json', 'package.json', 'package-lock.json', 'public']
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
    NEXT_PUBLIC_SITE_URL: origin, NEON_OTP_WEBHOOK_ENABLED: 'false', QQ_SMTP_AUTH_CODE: '', NEXT_TELEMETRY_DISABLED: '1',
    DEEPSEEK_API_KEY: 'local-completions-fixture', DEEPSEEK_API_BASE_URL: `http://127.0.0.1:${authPort}/deepseek/v1`,
    DEEPSEEK_MODEL: 'deepseek-v4.1-flash-1017' }
  await run(process.execPath, [next, 'build', '--webpack'], { cwd: buildDir, env })
  server = spawn(process.execPath, [next, 'start', '--hostname', '127.0.0.1', '--port', String(port)], { cwd: buildDir, env, stdio: 'inherit', windowsHide: true })
  await waitForHttp(origin)
  const result = await runApiChecks(origin, db, items, secret)
  console.log(JSON.stringify({ environment: { app: 'Next production build', node: process.version, postgres, network: 'loopback', auth: 'synthetic upstream' }, ...result }, null, 2))
  if (process.env.EQB_TEST_BROWSER === '1') {
    const { rows: [{ position }] } = await db.query(`
      SELECT count(*)::int AS position FROM questions
      WHERE status='published' AND id <= (SELECT id FROM questions WHERE type='multiple')
    `)
    const browserEnv = { ...process.env, EQB_TEST_ORIGIN: origin, EQB_TEST_COOKIE_NAME: tokenCookie, EQB_TEST_COOKIE_TOKEN: 'browser',
      EQB_TEST_MULTIPLE_POSITION: String(position), PYTHONUTF8: '1' }
    const python = process.env.EQB_TEST_PYTHON || 'python'
    await run(python, [join(root, 'tests', 'e2e', 'study-browser.py')], {
      cwd: root,
      env: browserEnv,
    })
    const browserWrites = await db.query("SELECT mode, count(*)::int AS count FROM attempts WHERE user_id=$1 GROUP BY mode ORDER BY mode", [users.get('browser').id])
    assert.deepEqual(browserWrites.rows, [{ mode: 'exam', count: 24 }, { mode: 'practice', count: 2 }])
    const browserFavorites = await db.query('SELECT count(*)::int AS count FROM favorites WHERE user_id=$1', [users.get('browser').id])
    assert.equal(browserFavorites.rows[0].count, 0)
    for (const account of ['conflict', 'receipt']) {
      const { rows } = await db.query("SELECT count(*)::int AS count FROM attempts WHERE user_id=$1 AND mode='exam'", [users.get(account).id])
      assert.equal(rows[0].count, 8)
    }
    await seedUnreadInbox(db)
    const libraryUser = users.get('personal-library').id
    const libraryItems = (await db.query("SELECT id FROM questions WHERE status = 'published' ORDER BY id LIMIT 21")).rows.map(({ id }) => id)
    assert.equal(libraryItems.length, 21)
    await db.query('INSERT INTO profiles (user_id) VALUES ($1)', [libraryUser])
    await db.query('INSERT INTO favorites (user_id, question_id) SELECT $1, unnest($2::uuid[])', [libraryUser, libraryItems])
    await db.query(`INSERT INTO question_progress (user_id, question_id, attempt_count, is_wrong)
      SELECT $1, unnest($2::uuid[]), 1, true`, [libraryUser, libraryItems])
    await run(python, [join(root, 'tests', 'e2e', 'additional_study_browser.py')], { cwd: root, env: browserEnv })
    const rejectedDrill = (await db.query(`
      SELECT (SELECT count(*) FROM attempts WHERE user_id = $1)::int AS attempts,
             (SELECT sum(attempt_count) FROM question_progress WHERE user_id = $1)::int AS progress
    `, [users.get('rejection').id])).rows[0]
    assert.deepEqual(rejectedDrill, { attempts: 1, progress: 1 })
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
