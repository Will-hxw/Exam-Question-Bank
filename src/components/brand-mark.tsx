import Image from 'next/image'
import { siteConfig } from '@/config/site'

export function BrandMark() {
  return (
    <a
      className="pointer-events-auto flex items-center gap-2.5 shrink-0 no-underline text-ink-primary bg-canvas-header backdrop-blur-md px-3 py-1.5 -ml-3 rounded-control"
      href={siteConfig.links.partyStudyHome}
      target="_blank"
      rel="noreferrer"
    >
      <Image
        className="rounded-full bg-white object-contain shrink-0"
        src={siteConfig.assets.crest}
        alt=""
        width={siteConfig.imageDimensions.headerCrest}
        height={siteConfig.imageDimensions.headerCrest}
        unoptimized
      />
      <span className="font-serif text-base font-bold tracking-tight">{siteConfig.title}</span>
    </a>
  )
}
