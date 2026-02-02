import type { NextConfig } from 'next'
import { env, getEnv, isTruthy } from './lib/core/config/env'
import { isDev, isHosted } from './lib/core/config/feature-flags'
import {
  getFormEmbedCSPPolicy,
  getMainCSPPolicy,
  getWorkflowExecutionCSPPolicy,
} from './lib/core/security/csp'

const nextConfig: NextConfig = {
  devIndicators: false,
  images: {
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
      ...(getEnv('NEXT_PUBLIC_BRAND_LOGO_URL')
        ? (() => {
            try {
              return [
                {
                  protocol: 'https' as const,
                  hostname: new URL(getEnv('NEXT_PUBLIC_BRAND_LOGO_URL')!).hostname,
                },
              ]
            } catch {
              return []
            }
          })()
        : []),
      // Brand favicon domain if configured
      ...(getEnv('NEXT_PUBLIC_BRAND_FAVICON_URL')
        ? (() => {
            try {
              return [
                {
                  protocol: 'https' as const,
                  hostname: new URL(getEnv('NEXT_PUBLIC_BRAND_FAVICON_URL')!).hostname,
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
  turbopack: {
    resolveExtensions: ['.tsx', '.ts', '.jsx', '.js', '.mjs', '.json'],
  },
  serverExternalPackages: [
    'unpdf',
    'ffmpeg-static',
    'fluent-ffmpeg',
    'pino',
    'pino-pretty',
    'thread-stream',
    'ws',
    'isolated-vm',
  ],
  outputFileTracingIncludes: {
    '/api/tools/stagehand/*': ['./node_modules/ws/**/*'],
    '/*': ['./node_modules/sharp/**/*', './node_modules/@img/**/*'],
  },
  experimental: {
    optimizeCss: true,
    turbopackSourceMaps: false,
    turbopackFileSystemCacheForDev: true,
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
  ],
  async headers() {
    return [
      {
        // API routes CORS headers
        source: '/api/:path*',
        headers: [
          { key: 'Access-Control-Allow-Credentials', value: 'true' },
          {
            key: 'Access-Control-Allow-Origin',
            value: env.NEXT_PUBLIC_APP_URL || 'http://localhost:3001',
          },
          {
            key: 'Access-Control-Allow-Methods',
            value: 'GET,POST,OPTIONS,PUT,DELETE',
          },
          {
            key: 'Access-Control-Allow-Headers',
            value:
              'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, X-API-Key',
          },
        ],
      },
      // For workflow execution API endpoints
      {
        source: '/api/workflows/:id/execute',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
          {
            key: 'Access-Control-Allow-Methods',
            value: 'GET,POST,OPTIONS,PUT',
          },
          {
            key: 'Access-Control-Allow-Headers',
            value:
              'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, X-API-Key',
          },
          { key: 'Cross-Origin-Embedder-Policy', value: 'unsafe-none' },
          { key: 'Cross-Origin-Opener-Policy', value: 'unsafe-none' },
          {
            key: 'Content-Security-Policy',
            value: getWorkflowExecutionCSPPolicy(),
          },
        ],
      },
      {
        // Exclude Vercel internal resources and static assets from strict COEP, Google Drive Picker to prevent 'refused to connect' issue
        source: '/((?!_next|_vercel|api|favicon.ico|w/.*|workspace/.*|api/tools/drive).*)',
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
        // For main app routes, Google Drive Picker, and Vercel resources - use permissive policies
        source: '/(w/.*|workspace/.*|api/tools/drive|_next/.*|_vercel/.*)',
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
      // Form pages - allow iframe embedding from any origin
      {
        source: '/form/:path*',
        headers: [
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          // No X-Frame-Options to allow iframe embedding
          {
            key: 'Content-Security-Policy',
            value: getFormEmbedCSPPolicy(),
          },
          // Permissive CORS for form API requests from embedded forms
          { key: 'Cross-Origin-Embedder-Policy', value: 'unsafe-none' },
          { key: 'Cross-Origin-Opener-Policy', value: 'unsafe-none' },
        ],
      },
      // Form API routes - allow cross-origin requests
      {
        source: '/api/form/:path*',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Access-Control-Allow-Methods', value: 'GET, POST, OPTIONS' },
          { key: 'Access-Control-Allow-Headers', value: 'Content-Type, X-Requested-With' },
          { key: 'Access-Control-Allow-Credentials', value: 'true' },
        ],
      },
      // Apply security headers to routes not handled by middleware runtime CSP
      // Middleware handles: /, /workspace/*, /chat/*
      // Exclude form routes which have their own permissive headers
      {
        source: '/((?!workspace|chat$|form).*)',
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

    // Redirect /building and /blog to /studio (legacy URL support)
    redirects.push(
      {
        source: '/building/:path*',
        destination: 'https://sim.ai/studio/:path*',
        permanent: true,
      },
      {
        source: '/blog/:path*',
        destination: 'https://sim.ai/studio/:path*',
        permanent: true,
      }
    )

    // Move root feeds to studio namespace
    redirects.push(
      {
        source: '/rss.xml',
        destination: '/studio/rss.xml',
        permanent: true,
      },
      {
        source: '/sitemap-images.xml',
        destination: '/studio/sitemap-images.xml',
        permanent: true,
      }
    )

    // Only enable domain redirects for the hosted version
    if (isHosted) {
      redirects.push(
        {
          source: '/((?!api|_next|_vercel|favicon|static|ingest|.*\\..*).*)',
          destination: 'https://www.sim.ai/$1',
          permanent: true,
          has: [{ type: 'host' as const, value: 'simstudio.ai' }],
        },
        {
          source: '/((?!api|_next|_vercel|favicon|static|ingest|.*\\..*).*)',
          destination: 'https://www.sim.ai/$1',
          permanent: true,
          has: [{ type: 'host' as const, value: 'www.simstudio.ai' }],
        }
      )
    }

    return redirects
  },
}

export default nextConfig
