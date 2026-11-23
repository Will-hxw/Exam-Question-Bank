/* global caches, self */

const cacheName = 'eqb-public-1'
const manifest = '/bank/manifest.json'
const shard = /^\/bank\/pages\/[a-f0-9]{64}\.json$/
const offline = '/offline.html'

self.addEventListener('install', event => {
  event.waitUntil(caches.open(cacheName).then(cache => cache.add(offline)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if ((key.startsWith('eqb-public-') && key !== cacheName) || key.startsWith('cquccp-')) await caches.delete(key)
    }
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', event => {
  const request = event.request
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== self.location.origin) return
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match(offline)))
    return
  }
  if (url.search || request.credentials !== 'omit' || (url.pathname !== manifest && !shard.test(url.pathname))) return
  event.respondWith(publicContent(request, url.pathname))
})

async function publicContent(request, path) {
  const cache = await caches.open(cacheName)
  if (path !== manifest) {
    const saved = await cache.match(request)
    if (saved) return saved
  }
  try {
    const response = await fetch(request)
    if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) return response
    if (path === manifest) {
      const { groups } = await response.clone().json()
      const active = new Set(Object.values(groups).flatMap(group => group.pages))
      for (const key of await cache.keys()) {
        const page = new URL(key.url).pathname
        if (shard.test(page) && !active.has(page)) await cache.delete(key)
      }
    }
    await cache.put(request, response.clone()).catch(() => {})
    const pages = (await cache.keys()).filter(key => shard.test(new URL(key.url).pathname))
    for (const key of pages.slice(0, -24)) await cache.delete(key)
    return response
  } catch {
    const saved = await cache.match(request)
    if (saved) return saved
    return new Response('{}', { status: 503, headers: { 'Content-Type': 'application/json' } })
  }
}
