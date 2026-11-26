import {
  isAuthPost,
  isSameOrigin,
  parseAuthPost,
} from "@/features/auth/request"
import { authRetryAfter } from "@/features/auth/rate-limit"
import {
  getAuth,
  privateCacheControl,
  privateJson,
} from "@/features/auth/server"
import { signupFollowupSite } from "@/features/auth/signup-followup-template"
import { query } from "@/server/db"

type Context = { params: Promise<{ path: string[] }> }

function withPrivateCache(response: Response) {
  const headers = new Headers(response.headers)
  headers.set("Cache-Control", privateCacheControl)
  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  })
}

async function emailIsRegistered(email: string) {
  try {
    const [result] = await query<{ registered: boolean }>(
      'SELECT EXISTS (SELECT 1 FROM neon_auth."user" WHERE email = $1) AS registered',
      [email],
    )
    return result?.registered === true
  } catch (error) {
    // A local application database may use a separately hosted Auth test instance.
    if (error && typeof error === "object" && "code" in error && error.code === "42P01") return false
    throw error
  }
}

export async function GET(request: Request, context: Context) {
  if ((await context.params).path.join("/") !== "get-session") {
    return privateJson({ code: "NOT_FOUND" }, 404)
  }

  try {
    const auth = getAuth()
    if (auth) return withPrivateCache(await auth.handler().GET(request, context))
  } catch {
    return privateJson({ code: "AUTH_UNAVAILABLE" }, 503)
  }
  return privateJson({ code: "AUTH_UNAVAILABLE" }, 503)
}

export async function POST(request: Request, context: Context) {
  const path = (await context.params).path.join("/")
  if (!isAuthPost(path)) return privateJson({ code: "NOT_FOUND" }, 404)

  try {
    if (!isSameOrigin(request)) return privateJson({ code: "INVALID_ORIGIN" }, 403)

    const input = await parseAuthPost(request, path)
    if (!input) return privateJson({ code: "INVALID_AUTH_INPUT" }, 400)

    const auth = getAuth()
    if (!auth) return privateJson({ code: "AUTH_UNAVAILABLE" }, 503)

    const email = "email" in input ? input.email : undefined
    if (email) {
      const retryAfter = await authRetryAfter(request, path, email)
      if (retryAfter > 0) {
        const response = privateJson({ code: "RATE_LIMITED" }, 429)
        response.headers.set("Retry-After", String(retryAfter))
        return response
      }
      if (path === "sign-up/email" && await emailIsRegistered(email)) {
        return privateJson({ code: "EMAIL_ALREADY_REGISTERED" }, 409)
      }
    }

    const url = new URL(request.url)
    url.search = ""
    const headers = new Headers(request.headers)
    headers.set("content-type", "application/json")
    headers.delete("content-length")
    const forwarded = new Request(url, {
      method: "POST",
      headers,
      body: JSON.stringify(input),
      signal: request.signal,
    })

    const response = await auth.handler().POST(forwarded, context)
    if (path === "email-otp/verify-email" && email && response.ok
      && process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") === signupFollowupSite) {
      await query("SELECT record_signup_followup_verifications($1)", [email]).catch(() => {
        console.error({ operation: "record_signup_followup_verification" })
      })
    }
    if (path === "sign-in/email" && email && response.status === 401) {
      const error = await response.clone().json().catch(() => null)
      if (error?.code === "INVALID_EMAIL_OR_PASSWORD" && await emailIsRegistered(email)) {
        return privateJson({ code: "INVALID_PASSWORD" }, 401)
      }
    }
    return withPrivateCache(response)
  } catch {
    return privateJson({ code: "AUTH_UNAVAILABLE" }, 503)
  }
}
