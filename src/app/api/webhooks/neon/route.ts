import { neonSigningKeys, verifyOtpEvent } from "@/features/auth/neon-webhook"
import { deliverOtp } from "@/features/auth/otp-delivery"
import { readLimitedBody } from "@/features/auth/request"
import { privateCacheControl, privateJson } from "@/features/auth/server"

export const runtime = "nodejs"

let signingKeys: ReturnType<typeof neonSigningKeys> | undefined

export async function POST(request: Request) {
  if (process.env.NEON_OTP_WEBHOOK_ENABLED !== "true") {
    return privateJson({ code: "NOT_FOUND" }, 404)
  }

  const baseUrl = process.env.NEON_AUTH_BASE_URL
  const endpointId = process.env.NEON_OTP_WEBHOOK_ENDPOINT_ID
  const smtpAuthorizationCode = process.env.QQ_SMTP_AUTH_CODE
  if (!baseUrl || !endpointId || !smtpAuthorizationCode) {
    return privateJson({ code: "DELIVERY_UNAVAILABLE" }, 503)
  }

  const body = await readLimitedBody(request, 16 * 1024)
  if (!body) return privateJson({ code: "INVALID_EVENT" }, 400)

  try {
    signingKeys ??= neonSigningKeys(baseUrl)
    const event = await verifyOtpEvent(body, request.headers, endpointId, signingKeys)
    if (!event) return privateJson({ code: "INVALID_EVENT" }, 400)
    if (!await deliverOtp(event, smtpAuthorizationCode)) {
      return privateJson({ code: "DELIVERY_UNAVAILABLE" }, 503)
    }
    return new Response(null, {
      status: 204,
      headers: { "Cache-Control": privateCacheControl },
    })
  } catch {
    return privateJson({ code: "DELIVERY_UNAVAILABLE" }, 503)
  }
}
