import type { NextConfig } from 'next'
import { DOCS_REDIRECTS } from '@/lib/redirects'

const config: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@sim/emcn', '@sim/workflow-renderer'],
  images: {
    deviceSizes: [384, 640, 828, 1080, 1440, 1920, 2560],
    imageSizes: [32, 48, 64, 96, 128, 256],
    qualities: [75, 90],
    minimumCacheTTL: 60,
    localPatterns: [{ pathname: '/_next/static/media/**' }, { pathname: '/static/**' }],
  },
  experimental: {
    useTypeScriptCli: true,
    webpackMemoryOptimizations: true,
    webpackBuildWorker: true,
  },
  async headers() {
    return [
      {
        source: '/llms-full.txt',
        headers: [
          { key: 'Content-Type', value: 'text/plain; charset=utf-8' },
          { key: 'Cache-Control', value: 'public, max-age=0, s-maxage=86400, must-revalidate' },
        ],
      },
    ]
  },
  async redirects() {
    return DOCS_REDIRECTS
  },
  async rewrites() {
    return [
      {
        source: '/:path*.mdx',
        destination: '/llms.mdx/:path*',
      },
      {
        source: '/:path*.md',
        destination: '/llms.mdx/:path*',
      },
    ]
  },
}

export default config
