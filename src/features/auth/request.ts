const maxAuthBodyBytes = 4_096

export const authPosts = [
  "sign-in/email",
  "sign-up/email",
  "sign-out",
  "email-otp/send-verification-otp",
  "email-otp/verify-email",
  "forget-password/email-otp",
  "email-otp/request-password-reset",
  "email-otp/reset-password",
] as const

export type AuthPost = (typeof authPosts)[number]

export function isAuthPost(path: string): path is AuthPost {
  return authPosts.some((entry) => entry === path)
}

export function isSameOrigin(request: Request) {
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? request.url
  return request.headers.get("origin") === new URL(site).origin
}

export async function readLimitedBody(request: Request, limit: number) {
  const declaredSize = request.headers.get("content-length")
  if (!request.body || (declaredSize !== null && Number(declaredSize) > limit)) {
    return null
  }

  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > limit) {
        await reader.cancel()
        return null
      }
      chunks.push(value)
    }
    const result = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) {
      result.set(chunk, offset)
      offset += chunk.byteLength
    }
    return result
  } catch {
    return null
  } finally {
    reader.releaseLock()
  }
}

async function readJson(request: Request): Promise<unknown> {
  const type = request.headers.get("content-type")?.split(";")[0].toLowerCase()
  if (type !== "application/json") return null
  const bytes = await readLimitedBody(request, maxAuthBodyBytes)
  if (!bytes) return null
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes))
  } catch {
    return null
  }
}

export function normalizeEmail(value: unknown) {
  if (typeof value !== "string") return ""
  const email = value.trim().toLowerCase()
  return email.length <= 254
    && /^[^\s@<>,;:()[\]]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/u.test(email)
    ? email
    : ""
}

export async function parseAuthPost(request: Request, path: AuthPost) {
  if (path === "sign-out") return {}

  const data = await readJson(request)
  if (typeof data !== "object" || data === null || !("email" in data)) {
    return null
  }

  const email = normalizeEmail(data.email)
  if (!email) return null

  const password = "password" in data ? data.password : null
  const otp = "otp" in data ? data.otp : null
  const hasPassword = typeof password === "string" && password.length <= 128
  const hasOtp = typeof otp === "string" && /^[0-9]{6}$/.test(otp)

  switch (path) {
    case "sign-in/email":
      return hasPassword && password.length > 0 ? { email, password } : null
    case "sign-up/email":
      return hasPassword && password.length >= 8
        ? { email, password, name: "同学" }
        : null
    case "email-otp/send-verification-otp":
      return "type" in data && data.type === "email-verification"
        ? { email, type: "email-verification" }
        : null
    case "email-otp/verify-email":
      return hasOtp ? { email, otp } : null
    case "email-otp/reset-password":
      return hasOtp && hasPassword && password.length >= 8
        ? { email, otp, password }
        : null
    default:
      return { email }
  }
}
