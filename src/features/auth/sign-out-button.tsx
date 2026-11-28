'use client'

import { useState } from 'react'
import { Button } from '@/components/ui'
import { messages } from '@/config/messages'
import { siteConfig } from '@/config/site'
import { authClient } from './client'

export function SignOutButton() {
  const [pending, setPending] = useState(false)

  const [failed, setFailed] = useState(false)

  async function signOut() {
    setFailed(false)
    setPending(true)
    try {
      const { error } = await authClient.signOut()
      if (error) throw error
      window.location.replace(siteConfig.routes.login)
    } catch {
      setFailed(true)
      setPending(false)
    }
  }

  return (
    <>
      <Button
        variant="surface"
        size="md"
        className="bg-canvas text-wrong-ink hover:bg-wrong-fill"
        disabled={pending}
        onClick={signOut}
      >
        {pending ? messages.account.signingOut : messages.account.signOut}
      </Button>
      {failed && <p className="m-0 w-full text-sm text-wrong-ink" role="alert">{messages.account.signOutFailed}</p>}
    </>
  )
}
