import path from 'node:path'
import type { NextConfig } from 'next'
import { env, isTruthy } from './lib/core/config/env'
import { isDev } from './lib/core/config/env-flags'
import {
  getChatEmbedCSPPolicy,
  getMainCSPPolicy,
  getWorkflowExecutionCSPPolicy,
} from './lib/core/security/csp'

/**
 * Dev-only escape hatch: when `SIM_DEV_MINIMAL_REGISTRY=1` (`bun run dev:minimal`),
 * swap the heavy block and tool registries for tiny curated variants via a
 * Turbopack/webpack resolve alias. The shared workspace layout drags the
 * ~247-tool registry (~2,074 modules) into every route via providers/utils →
 * tools/params, and the editor/executor pull all ~268 block configs; aliasing
 * both to minimal variants stops Turbopack from compiling those graphs, cutting
 * dev compile-time RAM (e.g. /logs ~16GB → ~5GB, 4.9min → ~15s). Only the
 * curated core blocks/tools work in this mode. Never enabled in production.
 */
const useMinimalRegistry = isDev && process.env.SIM_DEV_MINIMAL_REGISTRY === '1'
const minimalRegistryAlias: Record<string, string> = useMinimalRegistry
  ? {
      '@/tools/registry': './tools/registry.minimal.ts',
      '@/blocks/registry-maps': './blocks/registry-maps.minimal.ts',
    }
  : {}

const nextConfig: NextConfig = {
  devIndicators: false,
  poweredByHeader: false,
  turbopack: {
    root: path.join(import.meta.dirname, '../..'),
    resolveAlias: minimalRegistryAlias,
  },
  webpack: (config) => {
    if (useMinimalRegistry) {
      config.resolve.alias = {
        ...config.resolve.alias,
        '@/tools/registry$': path.resolve(import.meta.dirname, 'tools/registry.minimal.ts'),
        '@/blocks/registry-maps$': path.resolve(
          import.meta.dirname,
          'blocks/registry-maps.minimal.ts'
        ),
      }
    }
    return config
  },
  images: {
    formats: ['image/avif', 'image/webp'],
    /**
     * Allowed `quality` values for next/image. 75 is the app-wide default;
     * 90 exists for large photographic marketing assets (the landing hero
     * backdrop) where the default visibly softens texture.
     */
    qualities: [75, 90],
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'avatars.githubusercontent.com',
      },
      {
        protocol: 'https',
        hostname: 'api.stability.ai',
      },
      // Azure Blob Storage
      {
        protocol: 'https',
        hostname: '*.blob.core.windows.net',
      },
      // AWS S3
      {
        protocol: 'https',
        hostname: '*.s3.amazonaws.com',
      },
      {
        protocol: 'https',
        hostname: '*.s3.*.amazonaws.com',
      },
      {
        protocol: 'https',
        hostname: 'lh3.googleusercontent.com',
      },
      // Brand logo domain if configured
      ...(process.env.NEXT_PUBLIC_BRAND_LOGO_URL
        ? (() => {
            try {
              return [
                {
                  protocol: 'https' as const,
                  hostname: new URL(process.env.NEXT_PUBLIC_BRAND_LOGO_URL!).hostname,
                },
              ]
            } catch {
              return []
            }
          })()
        : []),
      // Brand favicon domain if configured
      ...(process.env.NEXT_PUBLIC_BRAND_FAVICON_URL
        ? (() => {
            try {
              return [
                {
                  protocol: 'https' as const,
                  hostname: new URL(process.env.NEXT_PUBLIC_BRAND_FAVICON_URL!).hostname,
                },
              ]
            } catch {
              return []
            }
          })()
        : []),
    ],
  },
  typescript: {
    ignoreBuildErrors: isTruthy(env.DOCKER_BUILD),
  },
  output: isTruthy(env.DOCKER_BUILD) ? 'standalone' : undefined,
  serverExternalPackages: [
    '@1password/sdk',
    'unpdf',
    'ffmpeg-static',
    'fluent-ffmpeg',
    'ws',
    'isolated-vm',
    '@e2b/code-interpreter',
    'e2b',
    '@earendil-works/pi-coding-agent',
  ],
  outputFileTracingIncludes: {
    '/api/tools/stagehand/*': ['./node_modules/ws/**/*'],
    '/*': [
      './node_modules/sharp/**/*',
      './node_modules/@img/**/*',
      './lib/execution/sandbox/bundles/*.cjs',
    ],
  },
  experimental: {
    optimizeCss: !isDev,
    turbopackFileSystemCacheForDev: false,
    preloadEntriesOnStart: false,
    optimizePackageImports: [
      'lodash',
      'framer-motion',
      'reactflow',
      '@radix-ui/react-dialog',
      '@radix-ui/react-dropdown-menu',
      '@radix-ui/react-popover',
      '@radix-ui/react-select',
      '@radix-ui/react-tabs',
      '@radix-ui/react-accordion',
      '@radix-ui/react-checkbox',
      '@radix-ui/react-switch',
      '@radix-ui/react-slider',
      'streamdown',
      'zod',
    ],
  },
  ...(isDev && {
    allowedDevOrigins: [
      ...(env.NEXT_PUBLIC_APP_URL
        ? (() => {
            try {
              return [new URL(env.NEXT_PUBLIC_APP_URL).host]
            } catch {
              return []
            }
          })()
        : []),
      'localhost:3000',
      'localhost:3001',
    ],
  }),
  transpilePackages: [
    'prettier',
    '@react-email/components',
    '@react-email/render',
    '@t3-oss/env-nextjs',
    '@t3-oss/env-core',
    '@sim/db',
    '@sim/emcn',
    '@sim/workflow-renderer',
  ],
  async headers() {
    return [
      {
        source: '/((?!api/).*\\.(?:svg|jpg|jpeg|png|gif|ico|webp|avif|woff|woff2|ttf|eot))',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=86400, stale-while-revalidate=604800',
          },
        ],
      },
      {
        source: '/.well-known/:path*',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Access-Control-Allow-Methods', value: 'GET, OPTIONS' },
          { key: 'Access-Control-Allow-Headers', value: 'Content-Type, Accept' },
        ],
      },
      // /api/* CORS is set at runtime in proxy.ts (resolveApiCorsPolicy).
      {
        source: '/api/workflows/:id/execute',
        headers: [
          { key: 'Cross-Origin-Embedder-Policy', value: 'unsafe-none' },
          { key: 'Cross-Origin-Opener-Policy', value: 'unsafe-none' },
          {
            key: 'Content-Security-Policy',
            value: getWorkflowExecutionCSPPolicy(),
          },
        ],
      },
      {
        // Exclude Vercel internal resources and static assets from strict COEP, Google Drive Picker
        // and the /demo Cal.com booking embed to prevent 'refused to connect' / slow-load issues
        source: '/((?!_next|_vercel|api|favicon.ico|w/.*|workspace/.*|api/tools/drive|demo).*)',
        headers: [
          {
            key: 'Cross-Origin-Embedder-Policy',
            value: 'credentialless',
          },
          {
            key: 'Cross-Origin-Opener-Policy',
            value: 'same-origin',
          },
        ],
      },
      {
        // For main app routes, Google Drive Picker, the /demo Cal.com embed, and Vercel resources - use permissive policies
        source: '/(w/.*|workspace/.*|api/tools/drive|demo.*|_next/.*|_vercel/.*)',
        headers: [
          {
            key: 'Cross-Origin-Embedder-Policy',
            value: 'unsafe-none',
          },
          {
            key: 'Cross-Origin-Opener-Policy',
            value: 'same-origin-allow-popups',
          },
        ],
      },
      // Block access to sourcemap files (defense in depth)
      {
        source: '/(.*)\\.map$',
        headers: [
          {
            key: 'x-robots-tag',
            value: 'noindex',
          },
        ],
      },
      // Chat pages - allow iframe embedding from any origin
      {
        source: '/chat/:path*',
        headers: [
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          // No X-Frame-Options to allow iframe embedding
          {
            key: 'Content-Security-Policy',
            value: getChatEmbedCSPPolicy(),
          },
          // Permissive CORS for chat requests from embedded chats
          { key: 'Cross-Origin-Embedder-Policy', value: 'unsafe-none' },
          { key: 'Cross-Origin-Opener-Policy', value: 'unsafe-none' },
        ],
      },
      // Apply security headers to routes not handled by middleware runtime CSP
      // Middleware handles: /, /login, /signup, /workspace/*
      // Exclude chat routes which have their own permissive embed headers
      {
        source: '/((?!workspace|chat|login|signup|$).*)',
        headers: [
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'X-Frame-Options',
            value: 'SAMEORIGIN',
          },
          {
            key: 'Content-Security-Policy',
            value: getMainCSPPolicy(),
          },
        ],
      },
    ]
  },
  async redirects() {
    const redirects = []

    // Social link redirects (used in emails to avoid spam filter issues)
    redirects.push(
      {
        source: '/discord',
        destination: 'https://discord.gg/Hr4UWYEcTT',
        permanent: false,
      },
      {
        source: '/x',
        destination: 'https://x.com/simdotai',
        permanent: false,
      },
      {
        source: '/github',
        destination: 'https://github.com/simstudioai/sim',
        permanent: false,
      },
      {
        source: '/team',
        destination: 'https://cal.com/emirkarabeg/sim-team',
        permanent: false,
      }
    )

    // Redirect /building and /studio to /blog (legacy URL support)
    redirects.push(
      {
        source: '/building/:path*',
        destination: 'https://www.sim.ai/blog/:path*',
        permanent: true,
      },
      {
        source: '/studio/:path*',
        destination: 'https://www.sim.ai/blog/:path*',
        permanent: true,
      }
    )

    /**
     * The marketing Academy course/lesson pages were removed; content is
     * consolidated into the docs site instead. Old course/lesson slugs have
     * no equivalent path there, so every sub-path collapses to the new
     * landing page rather than forwarding to a path that may not exist.
     */
    redirects.push({
      source: '/academy/:path*',
      destination: 'https://docs.sim.ai/academy',
      permanent: true,
    })

    // Move root feeds to blog namespace
    redirects.push(
      {
        source: '/rss.xml',
        destination: '/blog/rss.xml',
        permanent: true,
      },
      {
        source: '/sitemap-images.xml',
        destination: '/blog/sitemap-images.xml',
        permanent: true,
      }
    )

    // Legacy chat URL support: the workspace chat route was renamed from
    // `/workspace/:workspaceId/task/:chatId` to `/workspace/:workspaceId/chat/:chatId`.
    // Preserve existing bookmarks and deeplinks.
    redirects.push({
      source: '/workspace/:workspaceId/task/:chatId',
      destination: '/workspace/:workspaceId/chat/:chatId',
      permanent: true,
    })

    // Legacy integration slug: the incident.io block's display name was fixed
    // from `incidentio` to `incident.io`, which moved its catalog slug.
    // Preserve the previously indexed landing URL.
    redirects.push({
      source: '/integrations/incidentio',
      destination: '/integrations/incident-io',
      permanent: true,
    })

    /**
     * Legacy integration slug: the SAP block's display name was fixed from
     * `SAP S/4HANA` to `SAP S4HANA`, which moved its catalog slug. Preserves
     * the previously indexed landing URL.
     */
    redirects.push({
      source: '/integrations/sap-s-4hana',
      destination: '/integrations/sap-s4hana',
      permanent: true,
    })

    /**
     * Legacy integration slug: the Cal.com block's display name briefly
     * shipped as `CalCom` before being fixed to `Cal Com`/`Cal.com`, which
     * moved its catalog slug from `calcom` to `cal-com`.
     */
    redirects.push({
      source: '/integrations/calcom',
      destination: '/integrations/cal-com',
      permanent: true,
    })

    /**
     * The partner program page was removed; routes existing links/bookmarks
     * to contact instead of leaving a dead, previously-indexed URL.
     */
    redirects.push({
      source: '/partners',
      destination: '/contact',
      permanent: true,
    })

    return redirects
  },
  async rewrites() {
    return [
      {
        source: '/favicon.ico',
        destination: '/icon.svg',
      },
      {
        source: '/r/:shortCode',
        destination: 'https://go.trybeluga.ai/:shortCode',
      },
    ]
  },
}

export default nextConfig
