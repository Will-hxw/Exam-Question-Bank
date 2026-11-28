import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { connection } from "next/server"
import { messages } from "@/config/messages"
import { AccountPanel } from "@/features/auth/account-panel"
import { AccountScreen } from "@/features/auth/account-screen"
import { getVerifiedUser } from "@/features/auth/server"
import { siteConfig } from "@/config/site"
import { initialStudyPreferences } from "@/server/study-bootstrap"

export const metadata: Metadata = { title: messages.common.accountTitle(siteConfig.title) }

export default async function AccountPage() {
  await connection()
  const user = await getVerifiedUser().catch(() => null)
  if (!user) redirect(siteConfig.routes.login)

  return <AccountScreen userId={user.id} preferences={initialStudyPreferences(user.id)}>
    <AccountPanel email={user.email} />
  </AccountScreen>
}
