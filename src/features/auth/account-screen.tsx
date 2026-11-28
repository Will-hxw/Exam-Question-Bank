'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { siteConfig } from '@/config/site'
import { readStudyPreference, useStudyPreferencesReady, type StudyPreferences } from '@/features/study/preferences'
import { AuthScreen } from './auth-screen'

function themePreference(value: unknown) {
  return value === 'dark' || value === 'light' ? value : 'system'
}

export function AccountScreen({ userId, preferences, children }: {
  userId: string; preferences: Promise<StudyPreferences | null>; children: ReactNode
}) {
  const hydrated = useStudyPreferencesReady()
  const stored = hydrated ? readStudyPreference(siteConfig.storageKeys.studyPreferences(userId)) as
    { values?: StudyPreferences; pending?: StudyPreferences } | undefined : undefined
  const [remote, setRemote] = useState<StudyPreferences | null>(null)
  useEffect(() => {
    let active = true
    void Promise.resolve(preferences).then((value) => {
      if (active) setRemote(value)
    }, () => {})
    return () => { active = false }
  }, [preferences])
  const theme = themePreference(stored?.pending?.theme ?? (remote ? remote.theme : stored?.values?.theme))
  return <AuthScreen theme={theme}>{children}</AuthScreen>
}
