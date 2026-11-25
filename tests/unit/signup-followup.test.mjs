import assert from "node:assert/strict"
import { test } from "node:test"
import { generateKeyPair, SignJWT } from "jose"
import { isSignupFollowupRunner } from "../../src/features/auth/signup-followup-auth.ts"
import { signupFollowupTemplate } from "../../src/features/auth/signup-followup-template.ts"

test("signup follow-up retains the approved notice and feedback button", () => {
  const message = signupFollowupTemplate("1176843521@qq.com", new Date("2026-11-25T17:00:00Z"))
  assert.match(message.subject, /欢迎把题库分享给同学/)
  assert.match(message.html, /cid:cqu-crest@cqu\.xiaoweihua\.cn/)
  assert.match(message.html, /href="https:\/\/cqu\.xiaoweihua\.cn\/#feedback" style="display:block[^"]*">意见反馈<\/a>/)
  assert.match(message.text, /欢迎分享给身边的同学/)
  assert.match(message.text, /申请补偿/)
  assert.match(message.text, /2026 年 11 月 26 日/)
})

test("signup scheduled endpoint accepts only its signed production workflow identity", async () => {
  const { privateKey, publicKey } = await generateKeyPair("RS256")
  const resolveKey = async () => publicKey
  const audience = "https://cqu.xiaoweihua.cn/api/internal/signup-followup"
  async function authorize(claims = {}, tokenAudience = audience, expiration = "4m") {
    const token = await new SignJWT({
      repository_id: "1266193307",
      workflow_ref: "Will-hxw/Exam-Question-Bank/.github/workflows/signup-followup.yml@refs/heads/main",
      event_name: "schedule",
      ...claims,
    }).setProtectedHeader({ alg: "RS256" })
      .setIssuer("https://token.actions.githubusercontent.com")
      .setAudience(tokenAudience).setIssuedAt().setExpirationTime(expiration).sign(privateKey)
    return isSignupFollowupRunner("Bearer " + token, resolveKey)
  }
  assert.equal(await authorize(), true)
  assert.equal(await authorize({ event_name: "workflow_dispatch" }), true)
  assert.equal(await authorize({ event_name: "pull_request" }), false)
  assert.equal(await authorize({ repository_id: "123" }), false)
  assert.equal(await authorize({ workflow_ref: "Will-hxw/Exam-Question-Bank/.github/workflows/signup-followup.yml@refs/heads/preview" }), false)
  assert.equal(await authorize({}, "https://another.example.test"), false)
  assert.equal(await authorize({}, audience, Math.floor(Date.now() / 1000) - 60), false)
  assert.equal(await isSignupFollowupRunner(null, resolveKey), false)
})
