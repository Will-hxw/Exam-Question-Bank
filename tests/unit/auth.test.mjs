import assert from 'node:assert/strict'
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto'
import test from 'node:test'
import { verifyOtpEvent } from '../../src/features/auth/neon-webhook.ts'
import { brandImageCid, otpTemplate } from '../../src/features/auth/otp-template.ts'
import { isAuthPost, parseAuthPost } from '../../src/features/auth/request.ts'

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
  const withLogo = otpTemplate(fields, true, now)
  assert.match(withLogo.subject, /密码重置验证码/)
  assert.match(withLogo.html, /203684/)
  assert.ok(withLogo.html.includes(`cid:${brandImageCid}`))
  assert.match(withLogo.text, /203684/)
  assert.match(withLogo.text, /5 分钟/)

  const withoutLogo = otpTemplate({ ...fields, purpose: 'email-verification' }, false, now)
  assert.match(withoutLogo.subject, /邮箱验证码/)
  assert.doesNotMatch(withoutLogo.html, /<img/)
  assert.doesNotMatch(withoutLogo.html, /https?:\/\//)
})
