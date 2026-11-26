import { createHash } from "node:crypto"
import { isSignupFollowupRunner } from "@/features/auth/signup-followup-auth"
import { deliverSignupFollowup } from "@/features/auth/signup-followup-delivery"
import { signupFollowupSite } from "@/features/auth/signup-followup-template"
import { query } from "@/server/db"
import { HttpError, route } from "@/server/http"

export const runtime = "nodejs"

function isProduction() {
  return process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") === signupFollowupSite
}

async function isNeonScheduler(header: string | null) {
  const token = header?.match(/^Bearer (eqb-followup-[A-Za-z0-9_-]{43})$/)?.[1]
  if (!token) return false
  const digest = createHash("sha256").update(token).digest("hex")
  const [result] = await query<{ authorized: boolean }>(
    "SELECT EXISTS (SELECT 1 FROM signup_followup_scheduler WHERE token_digest = $1) AS authorized",
    [digest],
  )
  return result?.authorized === true
}

export const HEAD = route(async (request: Request) => {
  if (!isProduction() || !await isNeonScheduler(request.headers.get("authorization"))) {
    throw new HttpError(404, "接口不存在。")
  }
  return { ok: true }
})

export const POST = route(async (request: Request) => {
  if (!isProduction()) throw new HttpError(404, "接口不存在。")
  const authorization = request.headers.get("authorization")
  const neon = await isNeonScheduler(authorization)
  if (!neon && !await isSignupFollowupRunner(authorization)) throw new HttpError(404, "接口不存在。")
  const scheduled = neon ? Date.parse(request.headers.get("x-eqb-scheduled-at") ?? "") : NaN
  if (neon && (!Number.isFinite(scheduled) || scheduled % (2 * 60 * 60 * 1000) !== 0)) {
    throw new HttpError(400, "计划时间无效。")
  }
  const smtpAuthorizationCode = process.env.QQ_SMTP_AUTH_CODE
  if (!smtpAuthorizationCode) throw new HttpError(503, "邮件服务暂时不可用。")
  const delivery = await deliverSignupFollowup(smtpAuthorizationCode)
  if (delivery.result !== "sent" && delivery.result !== "idle") throw new HttpError(503, "邮件发送暂未完成。")
  if (neon) {
    await query(
      `UPDATE signup_followup_scheduler SET last_scheduled_at = $1, last_checked_at = statement_timestamp()
       WHERE singleton AND (last_scheduled_at IS NULL OR last_scheduled_at <= $1)`,
      [new Date(scheduled).toISOString()],
    )
  }
  return delivery
})
