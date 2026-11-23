import { redirect } from "next/navigation"
import { connection } from "next/server"
import { AuthPanel } from "@/features/auth/auth-panel"
import { getVerifiedUser } from "@/features/auth/server"

export default async function LoginPage() {
  await connection()
  const currentUser = await getVerifiedUser().catch(() => null)
  if (currentUser) redirect("/")

  return <AuthPanel />
}
