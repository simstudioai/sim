import path from 'node:path'
import type { NextConfig } from 'next'

/** Next bakes the base path into every route and asset URL, so it is fixed when the app is built. */
function readBasePath(value: string | undefined): string | undefined {
  if (!value) return undefined
  if (!/^(?:\/[\w-]+)+$/.test(value)) {
    throw new Error(`SIM_PLATFORM_BASE_PATH must look like /platform, received "${value}"`)
  }
  return value
}

const basePath = readBasePath(process.env.SIM_PLATFORM_BASE_PATH)
const apiOrigin = process.env.SIM_PLATFORM_API_ORIGIN
const emcnShim = path.join(import.meta.dirname, 'lib/data/emcn-shim.ts')

const config: NextConfig = {
  devIndicators: false,
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
  webpack(webpackConfig) {
    // No `$`, so `@sim/emcn/icons` resolves beneath the shim file and fails the build as missing.
    webpackConfig.resolve.alias['@sim/emcn'] = emcnShim
    // A named import the shim lacks is an error in our sources, not webpack's default warning.
    webpackConfig.module.rules.push({
      test: /\.tsx?$/,
      exclude: /node_modules/,
      parser: { importExportsPresence: 'error' },
    })
    return webpackConfig
  },
}

export default config
