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

    if ("email" in input && input.email) {
      const retryAfter = await authRetryAfter(request, path, input.email)
      if (retryAfter > 0) {
        const response = privateJson({ code: "RATE_LIMITED" }, 429)
        response.headers.set("Retry-After", String(retryAfter))
        return response
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

    return withPrivateCache(await auth.handler().POST(forwarded, context))
  } catch {
    return privateJson({ code: "AUTH_UNAVAILABLE" }, 503)
  }
}
