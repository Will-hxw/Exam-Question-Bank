import { getAuth, getVerifiedUser, privateJson } from "@/features/auth/server"

export async function GET() {
  try {
    if (!getAuth()) throw new Error("Auth is not configured")
    const user = await getVerifiedUser()
    return privateJson({ user })
  } catch {
    return privateJson({ user: null, code: "AUTH_UNAVAILABLE" }, 503)
  }
}
