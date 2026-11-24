import assert from 'node:assert/strict'
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto'
import test from 'node:test'
import { AuthApiError, AuthError } from '@neon/auth/next'
import { authConstraintError, authErrorMessage, authFieldError, authIssue } from '../../src/features/auth/client-errors.ts'
import { verifyOtpEvent } from '../../src/features/auth/neon-webhook.ts'
import { otpTemplate } from '../../src/features/auth/otp-template.ts'
import { isAuthPost, parseAuthPost } from '../../src/features/auth/request.ts'

test('Neon 包装的认证异常保留业务码和 HTTP 状态', () => {
  const origin = Object.assign(new AuthApiError('upstream details', 403, 'feature_not_supported'), {
    error: { status: 403, code: 'INVALID_ORIGIN', message: 'sensitive upstream details' },
  })
  assert.deepEqual(authIssue(origin), { status: 403, code: 'INVALID_ORIGIN' })
  assert.match(authErrorMessage(authIssue(origin), '注册失败'), /当前访问地址未通过认证/)
  assert.doesNotMatch(authErrorMessage(authIssue(origin), '注册失败'), /upstream/)

  const unverified = Object.assign(new AuthApiError('Email not verified', 422, 'email_not_confirmed'), {
    error: { status: 403, code: 'EMAIL_NOT_VERIFIED' },
  })
  assert.deepEqual(authIssue(unverified), { status: 403, code: 'EMAIL_NOT_VERIFIED' })
})

test('验证码、限流和服务异常使用安全提示，网络异常不当作业务错误', () => {
  const expired = Object.assign(new AuthApiError('upstream details', 400, 'validation_failed'), {
    error: { status: 400, code: 'OTP_EXPIRED' },
  })
  assert.equal(authErrorMessage(authIssue(expired), '验证失败'), '验证码已过期，请重新发送。')
  assert.equal(authErrorMessage(authIssue({ status: 429, code: 'RATE_LIMITED' }), '请求失败'), '尝试次数过多，请稍后再试。')
  assert.equal(authErrorMessage(authIssue(new AuthError('upstream details', 503)), '请求失败'), '认证服务暂时不可用，请稍后再试。')
  assert.equal(authErrorMessage(authIssue({ status: 401, code: 'UNKNOWN' }), '登录失败'), '登录失败')
  assert.equal(authIssue(new TypeError('Failed to fetch')), undefined)
})

test('已注册邮箱、无效凭据和错误验证码映射到各阶段的字段', () => {
  const cases = [
    ['register', 409, 'EMAIL_ALREADY_REGISTERED', 'email', /^该邮箱已注册，请登录。$/],
    ['register', 422, 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL', 'email', /^该邮箱已注册，请登录。$/],
    ['register', 422, 'email_exists', 'email', /^该邮箱已注册，请登录。$/],
    ['login', 401, 'INVALID_EMAIL_OR_PASSWORD', 'password', /邮箱或密码有误/],
    ['login', 401, 'invalid_credentials', 'password', /邮箱或密码有误/],
    ['login', 401, 'INVALID_PASSWORD', 'password', /^密码错误，请重试。$/],
    ['verify', 400, 'INVALID_OTP', 'otp', /^验证码错误，请重试。$/],
    ['reset', 400, 'INVALID_VERIFICATION_CODE', 'otp', /^验证码错误，请重试。$/],
    ['reset', 400, 'OTP_EXPIRED', 'otp', /验证码已过期/],
    ['reset', 400, 'PASSWORD_TOO_SHORT', 'password', /至少需要 8 个字符/],
  ]

  for (const [step, status, code, field, message] of cases) {
    const providerError = Object.assign(new AuthApiError('untrusted provider message', status), {
      error: { status, code, message: 'untrusted provider details' },
    })
    const issue = authFieldError(step, authIssue(providerError))
    assert.equal(issue?.field, field, `${step}: ${code}`)
    assert.match(issue.text, message)
    assert.doesNotMatch(issue.text, /untrusted/)
  }

  assert.equal(authFieldError('login', { status: 409, code: 'EMAIL_ALREADY_REGISTERED' }), undefined)
  assert.equal(authFieldError('register', { status: 409, code: 'UNKNOWN' }), undefined)
  assert.equal(authFieldError('forgot', { status: 400, code: 'INVALID_OTP' }), undefined)
  assert.equal(authFieldError('verify', { status: 429, code: 'INVALID_OTP' }), undefined)
  assert.equal(authFieldError('login', { status: 503, code: 'INVALID_EMAIL_OR_PASSWORD' }), undefined)
})

test('原生输入约束错误为对应字段提供固定提示', () => {
  const empty = { valueMissing: true, tooLong: false }
  const invalid = { valueMissing: false, tooLong: false }
  assert.deepEqual(authConstraintError('email', empty), { field: 'email', text: '请输入邮箱。' })
  assert.deepEqual(authConstraintError('email', invalid), { field: 'email', text: '请输入有效的邮箱地址。' })
  assert.deepEqual(authConstraintError('password', empty), { field: 'password', text: '请输入密码。' })
  assert.deepEqual(authConstraintError('password', invalid), { field: 'password', text: '密码至少需要 8 个字符。' })
  assert.deepEqual(authConstraintError('otp', invalid), { field: 'otp', text: '请输入 6 位验证码。' })
})

function authPost(body) {
  return new Request('https://exam.example.test/api/auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

test('邮箱注册入口移除外部回调和客户端自传名称', async () => {
  const parsed = await parseAuthPost(authPost({
    email: '  Test.User@Example.TEST  ',
    password: 'an-example-password',
    callbackURL: 'https://example.invalid/',
    name: 'User supplied',
  }), 'sign-up/email')
  assert.deepEqual(parsed, {
    email: 'test.user@example.test',
    password: 'an-example-password',
    name: '同学',
  })
})

test('认证入口拒绝超大请求、码字母、邮件头输入和密码免登录请求', async () => {
  assert.equal(await parseAuthPost(authPost({
    email: 'test@example.test',
    password: 'x'.repeat(5_000),
  }), 'sign-in/email'), null)
  assert.equal(await parseAuthPost(authPost({
    email: 'test@example.test',
    otp: 'abc123',
  }), 'email-otp/verify-email'), null)
  assert.equal(await parseAuthPost(authPost({
    email: 'member@example.test,other@example.test',
    type: 'email-verification',
  }), 'email-otp/send-verification-otp'), null)
  assert.equal(await parseAuthPost(authPost({
    email: 'member@example.test',
    type: 'sign-in',
  }), 'email-otp/send-verification-otp'), null)
  assert.equal(isAuthPost('sign-in/email-otp'), false)
})

const { publicKey, privateKey } = generateKeyPairSync('ed25519')
const now = Date.parse('2026-11-23T05:30:00.000Z')
const endpoint = 'ep-preview-example'
const kid = 'preview-key-example'

function signedFixture({
  issuedAt = now,
  clock = now,
  endpointId = endpoint,
  expiresAt = now + 5 * 60 * 1_000,
  type = 'email-verification',
  delivery = 'email',
} = {}) {
  const event = {
    event_id: randomUUID(),
    event_type: 'send.otp',
    timestamp: new Date(issuedAt).toISOString(),
    context: { endpoint_id: endpointId },
    user: { email: 'preview@example.test' },
    event_data: {
      otp_code: '203684',
      otp_type: type,
      expires_at: new Date(expiresAt).toISOString(),
      delivery_preference: delivery,
    },
  }
  const body = Buffer.from(JSON.stringify(event, null, 2))
  const protectedHeader = Buffer.from(JSON.stringify({ alg: 'EdDSA', kid })).toString('base64url')
  const encodedPayload = Buffer.from(`${clock}.${body.toString('base64url')}`).toString('base64url')
  const signature = sign(null, Buffer.from(`${protectedHeader}.${encodedPayload}`), privateKey)
  const headers = new Headers({
    'x-neon-signature-kid': kid,
    'x-neon-signature': `${protectedHeader}..${signature.toString('base64url')}`,
    'x-neon-timestamp': String(clock),
    'x-neon-event-id': event.event_id,
    'x-neon-event-type': 'send.otp',
  })
  return { body, headers, event }
}

const readKey = async (id) => id === kid ? publicKey : undefined

test('Webhook 验证原始签名、事件身份及邮件用途', async () => {
  const fixture = signedFixture({ type: 'forget-password' })
  assert.deepEqual(await verifyOtpEvent(fixture.body, fixture.headers, endpoint, readKey, now), {
    id: fixture.event.event_id,
    email: 'preview@example.test',
    code: '203684',
    purpose: 'forget-password',
    expiresAt: now + 5 * 60 * 1_000,
  })
})

test('Webhook 拒绝 JSON 重排、事件 ID 篡改和不同 endpoint', async () => {
  const { body, headers, event } = signedFixture()
  assert.equal(await verifyOtpEvent(Buffer.from(JSON.stringify(event)), headers, endpoint, readKey, now), null)
  assert.equal(await verifyOtpEvent(body, headers, 'another-endpoint', readKey, now), null)
  headers.set('x-neon-event-id', randomUUID())
  assert.equal(await verifyOtpEvent(body, headers, endpoint, readKey, now), null)
})

test('Webhook 拒绝旧签名、未来签名、过期验证码和其他投递类型', async () => {
  for (const options of [
    { clock: now - 6 * 60 * 1_000 },
    { clock: now + 31_000 },
    { expiresAt: now },
    { type: 'sign-in' },
    { delivery: 'sms' },
  ]) {
    const { body, headers } = signedFixture(options)
    assert.equal(await verifyOtpEvent(body, headers, endpoint, readKey, now), null)
  }
})

test('自定义邮件包含固定中文文案、可复制 OTP 与纯文本替代', () => {
  const fields = { purpose: 'forget-password', code: '203684', expiresAt: now + 5 * 60 * 1_000 }
  const reset = otpTemplate(fields, now)
  assert.match(reset.subject, /密码重置验证码/)
  assert.match(reset.html, /重庆大学入党积极分子练习/)
  assert.match(reset.html, /203684/)
  assert.match(reset.text, /203684/)
  assert.match(reset.text, /5 分钟/)

  const verify = otpTemplate({ ...fields, purpose: 'email-verification' }, now)
  assert.match(verify.subject, /邮箱验证码/)
  for (const { html } of [reset, verify]) {
    assert.match(html, /<img src="cid:cqu-crest@cqu\.xiaoweihua\.cn"/)
    assert.doesNotMatch(html, /https?:\/\//)
  }
})
