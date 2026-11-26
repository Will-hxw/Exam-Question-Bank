import { redirect } from "next/navigation"
import { AuthPanel } from "@/features/auth/auth-panel"
import { getVerifiedUser } from "@/features/auth/server"
import { studyDestination } from "@/features/auth/study-destination"

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const destination = studyDestination((await searchParams).next)
  const currentUser = await getVerifiedUser().catch(() => null)
  if (currentUser) redirect(destination)

  return <AuthPanel destination={destination} />
}
