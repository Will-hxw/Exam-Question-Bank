import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { connection } from "next/server"
import { messages } from "@/config/messages"
import { AccountPanel } from "@/features/auth/account-panel"
import { getVerifiedUser } from "@/features/auth/server"
import { siteConfig } from "@/config/site"

export const metadata: Metadata = { title: messages.common.accountTitle(siteConfig.title) }

export default async function AccountPage() {
  await connection()
  const user = await getVerifiedUser().catch(() => null)
  if (!user) redirect(siteConfig.routes.login)

  return <AccountPanel email={user.email} />
}
