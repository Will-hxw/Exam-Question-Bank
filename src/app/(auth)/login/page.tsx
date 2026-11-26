import { redirect } from "next/navigation"
import { AuthPanel } from "@/features/auth/auth-panel"
import { getVerifiedUser } from "@/features/auth/server"

export default async function LoginPage() {
  const currentUser = await getVerifiedUser().catch(() => null)
  if (currentUser) redirect("/")

  return <AuthPanel />
}
