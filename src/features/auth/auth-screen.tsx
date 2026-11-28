import Image from 'next/image'
import type { ReactNode } from 'react'
import { siteConfig } from '@/config/site'

export function AuthScreen({ children, theme = 'light' }: { children: ReactNode; theme?: 'light' | 'dark' | 'system' }) {
  return (
    <main data-theme={theme} className="min-h-dvh bg-canvas text-ink-primary flex flex-col items-center justify-center px-5 py-10">
      <div className="w-full max-w-auth flex flex-col animate-view-enter">
        <div className="flex justify-center mb-6">
          <Image
            src={siteConfig.assets.wordmark}
            alt={siteConfig.assets.crestAlt}
            width={siteConfig.imageDimensions.wordmarkWidth}
            height={siteConfig.imageDimensions.wordmarkHeight}
            className="auth-wordmark object-contain"
            preload
            unoptimized
          />
        </div>
        <div className="w-full">{children}</div>
      </div>
      <footer className="mt-10 font-credit text-lg text-ink-secondary text-center" lang="en">
        {siteConfig.visibleCredit}
      </footer>
    </main>
  )
}
