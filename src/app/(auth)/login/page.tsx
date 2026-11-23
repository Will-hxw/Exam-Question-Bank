import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { connection } from "next/server"
import { AuthPanel } from "@/features/auth/auth-panel"
import { getVerifiedUser } from "@/features/auth/server"

export const metadata: Metadata = { title: "登录 · 重庆大学入党积极分子练习" }

export default async function LoginPage() {
  await connection()
  const currentUser = await getVerifiedUser().catch(() => null)
  if (currentUser) redirect("/")

  return <AuthPanel />
}
