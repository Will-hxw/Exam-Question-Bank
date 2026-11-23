import type { Metadata } from 'next'
import { ServiceWorker } from './service-worker'
import './globals.css'

export const metadata: Metadata = {
  metadataBase: new URL('https://cqu.xiaoweihua.cn'),
  title: '重庆大学入党积极分子练习',
  description: '重庆大学入党积极分子专题练习、模拟考试与复盘。',
  icons: { icon: '/site-icon.png' },
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}<ServiceWorker /></body>
    </html>
  )
}
