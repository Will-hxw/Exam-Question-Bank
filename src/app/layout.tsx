import type { Metadata } from 'next'
import { siteConfig } from '@/config/site'
import { ServiceWorker } from './service-worker'
import './uno.css'

export const metadata: Metadata = {
  metadataBase: new URL(siteConfig.url),
  applicationName: siteConfig.appName,
  title: siteConfig.title,
  description: siteConfig.description,
  authors: [{ name: siteConfig.authorName }],
  icons: { icon: [{ url: siteConfig.assets.crest, type: 'image/png', sizes: '256x256' }] },
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body className="m-0 min-h-dvh bg-canvas text-ink-primary font-sans antialiased">
        {children}
        <ServiceWorker />
      </body>
    </html>
  )
}
