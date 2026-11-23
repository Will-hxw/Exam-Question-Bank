import "server-only"

import { createNeonAuth } from "@neon/auth/next/server"
import { NEON_AUTH_SESSION_COOKIE_NAME } from "@neon/auth/server"
import { cookies } from "next/headers"

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

export async function getVerifiedUser(): Promise<VerifiedUser | null> {
  const auth = getAuth()
  if (!auth) return null
  if (!(await cookies()).has(NEON_AUTH_SESSION_COOKIE_NAME)) return null

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
