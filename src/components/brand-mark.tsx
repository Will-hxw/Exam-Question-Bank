import Image from 'next/image'
import { siteConfig } from '@/config/site'

export function BrandMark() {
  return (
    <a
      className="pointer-events-auto min-w-0 inline-flex items-center gap-2 lg:gap-2.5 no-underline text-ink-primary py-1.5 rounded-control"
      aria-label={siteConfig.title}
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
      <span className="font-serif font-bold tracking-tight leading-tight">
        <span className="block text-sm lg:inline lg:text-base">{siteConfig.shortTitle}</span>
        <span className="block text-xs lg:inline lg:text-base">{siteConfig.subTitle}</span>
      </span>
    </a>
  )
}
