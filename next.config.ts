import type { NextConfig } from 'next'

const devScriptPolicy = process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : ''

const config: NextConfig = {
  agentRules: false,
  devIndicators: false,
  poweredByHeader: false,
  outputFileTracingIncludes: {
    '/': ['./public/bank/manifest.json', './public/bank/pages/*.json'],
    '/api/webhooks/neon': ['./public/cqu-crest.png'],
  },
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'same-origin' },
        { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        { key: 'Content-Security-Policy', value: `default-src 'self'; script-src 'self' 'unsafe-inline'${devScriptPolicy}; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'` },
      ],
    }, {
      source: '/bank/pages/:asset',
      headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
    }, {
      source: '/fonts/:asset.woff',
      headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
    }, {
      source: '/ui-images/:asset.webp',
      headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
    }, {
      source: '/bank/manifest.json',
      headers: [{ key: 'Cache-Control', value: 'public, max-age=0, must-revalidate' }],
    }, {
      source: '/sw.js',
      headers: [{ key: 'Cache-Control', value: 'no-cache' }],
    }]
  },
}

export default config
