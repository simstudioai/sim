import { createMDX } from 'fumadocs-mdx/next'
import type { NextConfig } from 'next'

const withMDX = createMDX()

const config: NextConfig = {
  reactStrictMode: true,
  images: {
    unoptimized: true,
  },
  experimental: {
    webpackMemoryOptimizations: true,
    webpackBuildWorker: true,
  },
  async redirects() {
    return [
      {
        source: '/',
        destination: '/introduction',
        permanent: true,
      },
    ]
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
