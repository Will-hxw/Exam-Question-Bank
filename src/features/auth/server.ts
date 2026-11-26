import "server-only"

import { createNeonAuth } from "@neon/auth/next/server"
import { NEON_AUTH_SESSION_COOKIE_NAME } from "@neon/auth/server"
import { cookies } from "next/headers"
import { HttpError, sameOrigin } from "@/server/http"

export const authorEmail = "xiaoweihuacqu@gmail.com"

export type VerifiedUser = {
  id: string
  email: string
  name?: string
}

export const privateCacheControl = "private, no-store"

export function getAuth() {
  const baseUrl = process.env.NEON_AUTH_BASE_URL
  const secret = process.env.NEON_AUTH_COOKIE_SECRET

  if (!baseUrl || !secret || secret.length < 32) {
    return null
  }

  return createNeonAuth({
    baseUrl,
    cookies: { secret, sameSite: "strict" },
    logLevel: "silent",
  })
}

export function privateJson(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": privateCacheControl },
  })
}

export async function getVerifiedUser(auth?: ReturnType<typeof getAuth>): Promise<VerifiedUser | null> {
  if (!(await cookies()).has(NEON_AUTH_SESSION_COOKIE_NAME)) return null
  auth ??= getAuth()
  if (!auth) return null

  const { data, error } = await auth.getSession({
    query: { disableCookieCache: "true" },
  })
  if (error) {
    if (error.status === 401 || error.status === 403) return null
    throw new Error("Session lookup failed")
  }

  const user = data?.user
  if (!data?.session || !user?.emailVerified) return null

  return { id: user.id, email: user.email, name: user.name || undefined }
}

export function isSiteAuthor(user: VerifiedUser) {
  return user.email === authorEmail
}

export async function requireStudyAccount(request: Request, writing = false) {
  if (writing) sameOrigin(request)
  const auth = getAuth()
  if (!auth) throw new HttpError(503, '账号服务暂未配置。')
  const user = await getVerifiedUser(auth)
  if (!user) throw new HttpError(401, '请登录并验证邮箱。')
  const expectedAccount = request.headers.get('x-study-account')
  if ((writing || expectedAccount !== null) && expectedAccount !== user.id) {
    throw new HttpError(409, '当前账号已切换，请刷新后再试。')
  }
  return user
}
