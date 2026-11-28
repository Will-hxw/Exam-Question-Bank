import Link from 'next/link'
import { BackArrowIcon } from '@/components/icons'
import { messages } from '@/config/messages'
import { siteConfig } from '@/config/site'
import { SignOutButton } from './sign-out-button'

export function AccountPanel({ email, name }: { email?: string; name?: string }) {
  return (
    <section aria-labelledby="account-heading" className="w-full max-w-auth-card mx-auto pt-6 animate-view-enter">
      <h1 id="account-heading" className="font-serif m-0 mb-6 text-page-title font-bold text-ink-primary tracking-tight">
        {messages.common.accountLabel}
      </h1>
      <div className="p-6 rounded-option bg-surface flex flex-col gap-5">
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-muted">{messages.account.signedInAs}</span>
          <strong className="text-base font-semibold text-ink-primary break-all">{email || name || messages.common.accountLabel}</strong>
        </div>
        <div className="flex items-center justify-between gap-3 flex-wrap pt-2">
          <Link href={siteConfig.routes.practice} className="btn-surface h-10 px-4 rounded-compact inline-flex items-center gap-1.5 text-meta font-medium no-underline">
            <BackArrowIcon />
            {messages.common.backToPractice}
          </Link>
          <SignOutButton />
        </div>
      </div>
    </section>
  )
}
