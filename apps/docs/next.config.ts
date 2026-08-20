import { createMDX } from 'fumadocs-mdx/next'

const withMDX = createMDX()

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  async redirects() {
    return [
      {
        source: '/',
        destination: '/introduction',
        permanent: true,
      },
      {
        source: '/docs/:path*.mdx',
        destination: '/llms.mdx/:path*',
        permanent: true,
      },
    ]
  },
}

export default withMDX(config)
