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
