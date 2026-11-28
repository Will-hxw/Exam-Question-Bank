import Image from 'next/image'
import { messages } from '@/config/messages'
import { siteConfig } from '@/config/site'

export function SponsorCard() {
  return (
    <div className="text-center">
      <h1 id="sponsor-title" className="font-serif m-0 mb-2 text-lg font-bold text-ink-primary">
        {messages.sponsor.title}
      </h1>
      <div className="mb-5 text-body leading-relaxed text-ink-secondary">
        {messages.sponsor.lines.map((line) => <p key={line} className="m-0">{line}</p>)}
      </div>
      <div className="inline-block p-3 rounded-option bg-white">
        <Image
          src={siteConfig.assets.sponsorQr}
          alt={messages.sponsor.qrAlt}
          width={siteConfig.imageDimensions.sponsorQr}
          height={siteConfig.imageDimensions.sponsorQr}
          className="block w-55 h-auto rounded-compact"
          loading="eager"
          fetchPriority="high"
          unoptimized
        />
      </div>
    </div>
  )
}
