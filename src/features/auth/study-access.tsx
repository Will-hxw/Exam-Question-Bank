import 'server-only'

import { cache, type ReactNode } from 'react'
import { redirect } from 'next/navigation'
import { connection } from 'next/server'
import { getAuth, getVerifiedUser } from './server'
import { studyLoginPath, type StudyDestination } from './study-destination'

export const loadStudyUser = cache(async () => {
  await connection()
  try {
    const auth = getAuth()
    if (!auth) return { available: false } as const
    return { available: true, user: await getVerifiedUser(auth) } as const
  } catch (cause) {
    console.error({ operation: 'study-session', error: cause instanceof Error ? cause.name : 'Error' })
    return { available: false } as const
  }
})

export async function StudyPage({ path, children }: { path: StudyDestination; children: ReactNode }) {
  const auth = await loadStudyUser()
  if (!auth.available) return null
  if (!auth.user) redirect(studyLoginPath(path))
  return children
}
