import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { connection } from "next/server"
import { AccountPanel } from "@/features/auth/account-panel"
import { getVerifiedUser } from "@/features/auth/server"

export const metadata: Metadata = { title: "账号 · 重庆大学入党积极分子练习" }

export default async function AccountPage() {
  await connection()
  const user = await getVerifiedUser().catch(() => null)
  if (!user) redirect("/login")

  return <AccountPanel email={user.email} />
}
