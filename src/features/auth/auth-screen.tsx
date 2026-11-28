import Image from 'next/image'
import type { ReactNode } from 'react'
import { ColophonCredit } from '@/components/colophon-credit'
import { siteConfig } from '@/config/site'

export function AuthScreen({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-dvh bg-canvas text-ink-primary flex flex-col items-center justify-center px-5 py-10">
      <div className="w-full max-w-auth flex flex-col animate-view-enter">
        <div className="flex justify-center mb-6">
          <Image
            src={siteConfig.assets.wordmark}
            alt={siteConfig.assets.crestAlt}
            width={siteConfig.imageDimensions.wordmarkWidth}
            height={siteConfig.imageDimensions.wordmarkHeight}
            className="object-contain dark:invert dark:brightness-110"
            preload
            unoptimized
          />
        </div>
        <div className="w-full">{children}</div>
      </div>
      <footer className="mt-10 text-ink-muted text-center flex flex-col items-center gap-1.5" lang="en">
        <span className="text-xs">{siteConfig.visibleCredit}</span>
        <ColophonCredit />
      </footer>
    </main>
  )
}
