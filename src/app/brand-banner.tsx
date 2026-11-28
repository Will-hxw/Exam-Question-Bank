'use client'

import { useEffect } from 'react'
import { __TFAULTXIOS_WATERMARK__, siteConfig } from '@/config/site'
import { semanticColors } from '@/config/theme'

declare global {
  interface Window {
    __TFAULTXIOS_META__?: typeof __TFAULTXIOS_WATERMARK__
  }
}

export function BrandBanner() {
  useEffect(() => {
    window.__TFAULTXIOS_META__ = __TFAULTXIOS_WATERMARK__
    const accentColor = getComputedStyle(document.documentElement).getPropertyValue(semanticColors['selected-badge'].cssVar).trim() || 'currentColor'
    const { asciiArt, handle, github, copyright, feedbackInvite, consoleFontStyle } = siteConfig.codeAuthor
    console.log(
      `%c${asciiArt}\n\n${siteConfig.title} | ${copyright} ${handle}\nGitHub: ${github}\n${feedbackInvite}`,
      `color:${accentColor};${consoleFontStyle}`,
    )
  }, [])

  return null
}
