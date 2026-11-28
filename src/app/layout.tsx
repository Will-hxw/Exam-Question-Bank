import type { Metadata } from 'next'
import { Instrument_Serif, Inter, Noto_Serif_SC } from 'next/font/google'
import { siteConfig } from '@/config/site'
import { BrandBanner } from './brand-banner'
import { ServiceWorker } from './service-worker'
import './uno.css'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
})

const notoSerifSc = Noto_Serif_SC({
  weight: ['500', '600', '700'],
  preload: false,
  variable: '--font-serif',
  display: 'swap',
})

const instrumentSerif = Instrument_Serif({
  weight: '400',
  style: ['normal', 'italic'],
  subsets: ['latin'],
  variable: '--font-editorial',
  display: 'swap',
})

export const metadata: Metadata = {
  metadataBase: new URL(siteConfig.url),
  applicationName: siteConfig.appName,
  title: siteConfig.title,
  description: siteConfig.description,
  authors: [{ name: siteConfig.codeAuthor.handle, url: siteConfig.codeAuthor.github }],
  creator: siteConfig.codeAuthor.handle,
  other: {
    copyright: siteConfig.codeAuthor.copyright,
    contact: siteConfig.codeAuthor.email,
    'feedback-notice': siteConfig.codeAuthor.feedbackInvite,
  },
  icons: { icon: [{ url: siteConfig.assets.crest, type: 'image/png', sizes: '256x256' }] },
}

const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'WebApplication',
  name: siteConfig.title,
  url: siteConfig.url,
  author: {
    '@type': 'Person',
    name: siteConfig.codeAuthor.handle,
    email: siteConfig.codeAuthor.email,
    url: siteConfig.codeAuthor.github,
  },
  comment: siteConfig.codeAuthor.feedbackInvite,
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="zh-CN"
      className={`${inter.variable} ${notoSerifSc.variable} ${instrumentSerif.variable}`}
      data-author={siteConfig.codeAuthor.handle}
      data-feedback={siteConfig.codeAuthor.email}
    >
      <body className="m-0 min-h-dvh bg-canvas text-ink-primary font-sans antialiased">
        {children}
        <ServiceWorker />
        <BrandBanner />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </body>
    </html>
  )
}
