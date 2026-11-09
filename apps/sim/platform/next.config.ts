import type { NextConfig } from 'next'

/** Next bakes the base path into every route and asset URL, so it is fixed when the app is built. */
function readBasePath(value: string | undefined): string | undefined {
  if (!value) return undefined
  if (!/^(?:\/[\w-]+)+$/.test(value)) {
    throw new Error(`SIM_PLATFORM_BASE_PATH must look like /org, received "${value}"`)
  }
  return value
}

const basePath = readBasePath(process.env.SIM_PLATFORM_BASE_PATH)
const apiOrigin = process.env.SIM_PLATFORM_API_ORIGIN

const config: NextConfig = {
  /** A second local server, such as a live one beside the fixture preview, needs its own build and lock. */
  ...(process.env.SIM_PLATFORM_DIST_DIR && { distDir: process.env.SIM_PLATFORM_DIST_DIR }),
  devIndicators: false,
  /** The Workflows tab compiles the whole block registry and editor; webpack's leaner mode keeps dev under its restart threshold. */
  experimental: { webpackMemoryOptimizations: true },
  poweredByHeader: false,
  /** `bun run type-check` proves this; a small runner spends its whole budget on it otherwise. */
  typescript: { ignoreBuildErrors: process.env.NEXT_BUILD_SKIP_TYPE_CHECK === '1' },
  ...(basePath && { basePath }),
  env: { NEXT_PUBLIC_SIM_PLATFORM_BASE_PATH: basePath ?? '' },
  /** Published as ESM that only compiles through this list, as in the main app's config. */
  transpilePackages: ['@t3-oss/env-nextjs', '@t3-oss/env-core'],
  /**
   * Without a base path nothing proxies this origin, so it has no same-origin API of its own.
   * Behind the zone rewrite the browser reaches `/api` on the main app directly.
   */
  async rewrites() {
    return !basePath && apiOrigin
      ? [
          {
            source: '/api/:path*',
            destination: `${apiOrigin}/api/:path*`,
            basePath: false as const,
          },
        ]
      : []
  },
}

export default config
