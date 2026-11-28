'use client'

import { useState } from 'react'
import { Button } from '@/components/ui'
import { messages } from '@/config/messages'
import { siteConfig } from '@/config/site'
import { authClient } from './client'

export function SignOutButton() {
  const [pending, setPending] = useState(false)

  async function signOut() {
    setPending(true)
    try {
      await authClient.signOut()
      window.location.assign(siteConfig.routes.login)
    } catch {
      setPending(false)
    }
  }

  return (
    <Button
      variant="surface"
      size="md"
      className="bg-canvas text-wrong-ink hover:bg-wrong-fill"
      disabled={pending}
      onClick={signOut}
    >
      {pending ? messages.account.signingOut : messages.account.signOut}
    </Button>
  )
}
