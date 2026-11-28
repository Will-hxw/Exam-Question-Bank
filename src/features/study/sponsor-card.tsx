import Image from 'next/image'
import { messages } from '@/config/messages'
import { siteConfig } from '@/config/site'

export function SponsorCard() {
  return (
    <section aria-labelledby="sponsor-title" className="text-center">
      <h2 id="sponsor-title" className="font-serif m-0 mb-2 text-lg font-bold text-ink-primary">
        {messages.sponsor.title}
      </h2>
      <p className="m-0 mb-5 text-meta leading-relaxed text-ink-secondary">
        {messages.sponsor.body}
      </p>
      <div className="inline-block p-3 rounded-option bg-white">
        <Image
          src={siteConfig.assets.sponsorQr}
          alt={messages.sponsor.qrAlt}
          width={siteConfig.imageDimensions.sponsorQr}
          height={siteConfig.imageDimensions.sponsorQr}
          className="block w-55 h-auto rounded-compact"
          unoptimized
        />
      </div>
    </section>
  )
}
