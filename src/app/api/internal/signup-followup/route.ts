import { isSignupFollowupRunner } from "@/features/auth/signup-followup-auth"
import { deliverSignupFollowup } from "@/features/auth/signup-followup-delivery"
import { signupFollowupSite } from "@/features/auth/signup-followup-template"
import { HttpError, route } from "@/server/http"

export const runtime = "nodejs"

export const POST = route(async (request: Request) => {
  if (process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") !== signupFollowupSite
    || !await isSignupFollowupRunner(request.headers.get("authorization"))) {
    throw new HttpError(404, "接口不存在。")
  }
  const smtpAuthorizationCode = process.env.QQ_SMTP_AUTH_CODE
  if (!smtpAuthorizationCode) throw new HttpError(503, "邮件服务暂时不可用。")
  const delivery = await deliverSignupFollowup(smtpAuthorizationCode)
  if (delivery.result !== "sent" && delivery.result !== "idle") throw new HttpError(503, "邮件发送暂未完成。")
  return delivery
})
