'use client'

import { useEffect } from 'react'
import { siteConfig } from '@/config/site'

export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return
    void navigator.serviceWorker.register(siteConfig.serviceWorker.path, { updateViaCache: 'none' }).catch(() => {})
  }, [])
  return null
}
