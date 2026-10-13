import { createMDX } from 'fumadocs-mdx/next'
import type { NextConfig } from 'next'
import { DOCS_REDIRECTS } from './lib/redirects'

const withMDX = createMDX()

const config: NextConfig = {
  reactStrictMode: true,
  productionBrowserSourceMaps: true,
  transpilePackages: ['@sim/emcn', '@sim/workflow-renderer'],
  images: {
    unoptimized: true,
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
    ]
  },
}

export default withMDX(config)
