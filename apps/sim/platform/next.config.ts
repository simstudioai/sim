import { createRequire } from 'node:module'
import path from 'node:path'
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
/**
 * Modules the chat hook reaches that the zone answers more cheaply. Each shim says what it drops. The
 * workflow stores are real: the Workflows tab's canvas hydrates them in the same bundle.
 */
const canvasShims = [
  ['@/lib/mothership/tools/client/block-name', 'lib/data/shims/block-name.ts'],
] as const
/**
 * The shared socket provider (and its operation queue) and the chat hook (its stream helpers, run tool,
 * execution helper and the execution store) import workflow state, and one of them is on every Platform page. The real stores
 * pull in every block and trigger, so for these importers alone a bridge stands in that reads the real
 * stores once the Workflows tab connects them, and an idle workflow before.
 */
const workflowStateBridges = [
  ['@/stores/workflows/registry/store', 'lib/data/shims/workflow-state/registry-store.ts'],
  ['@/stores/workflows/workflow/store', 'lib/data/shims/workflow-state/workflow-store.ts'],
  ['@/stores/workflows/subblock/store', 'lib/data/shims/workflow-state/subblock-store.ts'],
  ['@/stores/workflow-diff/store', 'lib/data/shims/workflow-state/workflow-diff-store.ts'],
  ['@/stores/workflows/sync-local-draft', 'lib/data/shims/workflow-state/sync-local-draft.ts'],
  ['@/stores/variables/store', 'lib/data/shims/workflow-state/variables-store.ts'],
] as const
const bridgedImporters = [
  'components/workspace-providers/socket-provider.tsx',
  'hooks/mothership-chat/use-chat.ts',
  'lib/mothership/tools/client/run-tool-execution.ts',
  'components/workflow-editor/utils/workflow-execution.ts',
  'stores/execution/store.ts',
  'hooks/mothership-chat/stream/helpers.ts',
  'stores/operation-queue/store.ts',
] as const

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
  webpack(webpackConfig, { isServer, webpack }) {
    // `@sim/logger` requires this behind a runtime Node check, so browsers never evaluate it.
    if (!isServer) {
      webpackConfig.plugins.push(new webpack.IgnorePlugin({ resourceRegExp: /^node:async_hooks$/ }))
    }
    // pdf.js ships a webpack bundle whose top-level `var __webpack_exports__` shadows webpack's own
    // module parameter when it is bundled again; the minified build mangles that name. The legacy
    // build matches the self-polyfilling worker the PDF viewer loads.
    webpackConfig.resolve.alias['pdfjs-dist$'] = createRequire(import.meta.url).resolve(
      'pdfjs-dist/legacy/build/pdf.min.mjs'
    )
    // A replacement, because tsconfig paths resolve `@/` before any alias is consulted.
    for (const [request, shim] of canvasShims) {
      webpackConfig.plugins.push(
        new webpack.NormalModuleReplacementPlugin(
          new RegExp(`^${request}$`),
          path.join(import.meta.dirname, shim)
        )
      )
    }
    // Every other importer, the canvas included, keeps the real store.
    const importers = new Set<string>(
      bridgedImporters.map((file) => path.join(import.meta.dirname, '..', file))
    )
    for (const [request, bridge] of workflowStateBridges) {
      webpackConfig.plugins.push(
        new webpack.NormalModuleReplacementPlugin(
          new RegExp(`^${request}$`),
          (resource: { request: string; contextInfo?: { issuer?: string } }) => {
            if (importers.has(resource.contextInfo?.issuer ?? '')) {
              resource.request = path.join(import.meta.dirname, bridge)
            }
          }
        )
      )
    }
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
