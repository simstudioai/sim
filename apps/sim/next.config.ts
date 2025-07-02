import path from 'path'
import { withSentryConfig } from '@sentry/nextjs'
import type { NextConfig } from 'next'
import { env, isTruthy } from './lib/env'

const nextConfig: NextConfig = {
  devIndicators: false,
  images: {
    domains: [
      'avatars.githubusercontent.com',
      'oaidalleapiprodscus.blob.core.windows.net',
      'api.stability.ai',
    ],
  },
  typescript: {
    ignoreBuildErrors: isTruthy(env.DOCKER_BUILD),
  },
  eslint: {
    ignoreDuringBuilds: isTruthy(env.DOCKER_BUILD),
  },
  output: isTruthy(env.DOCKER_BUILD) ? 'standalone' : undefined,
  turbopack: {
    resolveExtensions: ['.tsx', '.ts', '.jsx', '.js', '.mjs', '.json'],
  },
  experimental: {
    optimizeCss: true,
  },
  ...(env.NODE_ENV === 'development' && {
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
    outputFileTracingRoot: path.join(__dirname, '../../'),
  }),
  webpack: (config, { isServer, dev }) => {
    // Skip webpack configuration in development when using Turbopack
    if (dev && env.NEXT_RUNTIME === 'turbopack') {
      return config
    }

    // Configure webpack to use filesystem cache for faster incremental builds
    if (config.cache) {
      config.cache = {
        type: 'filesystem',
        buildDependencies: {
          config: [__filename],
        },
        cacheDirectory: path.resolve(process.cwd(), '.next/cache/webpack'),
      }
    }

    // Avoid aliasing React on the server/edge runtime builds because it bypasses
    // the "react-server" export condition, which Next.js relies on when
    // bundling React Server Components and API route handlers.
    if (!isServer) {
      config.resolve.alias = {
        ...config.resolve.alias,
        react: path.join(__dirname, '../../node_modules/react'),
        'react-dom': path.join(__dirname, '../../node_modules/react-dom'),
      }
    }

    return config
  },
  transpilePackages: ['prettier', '@react-email/components', '@react-email/render'],
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
            value: "default-src * 'unsafe-inline' 'unsafe-eval'; connect-src *;",
          },
        ],
      },
      {
        // Exclude Vercel internal resources and static assets from strict COEP
        source: '/((?!_next|_vercel|api|favicon.ico|w/.*|api/tools/drive).*)',
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
            value: 'same-origin',
          },
        ],
      },
      // Apply security headers to all routes
      {
        source: '/:path*',
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
            value: `default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://*.google.com https://apis.google.com https://*.vercel-scripts.com https://*.vercel-insights.com https://vercel.live https://*.vercel.live https://vercel.com https://*.vercel.app https://vitals.vercel-insights.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: blob: https://*.googleusercontent.com https://*.google.com https://*.atlassian.com https://cdn.discordapp.com https://*.githubusercontent.com; media-src 'self' blob:; font-src 'self' https://fonts.gstatic.com; connect-src 'self' ${env.NEXT_PUBLIC_APP_URL || ''} ${env.OLLAMA_URL || 'http://localhost:11434'} ${env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:3002'} ${env.NEXT_PUBLIC_SOCKET_URL?.replace('http://', 'ws://').replace('https://', 'wss://') || 'ws://localhost:3002'} https://*.up.railway.app wss://*.up.railway.app https://api.browser-use.com https://*.googleapis.com https://*.amazonaws.com https://*.s3.amazonaws.com https://*.blob.core.windows.net https://*.vercel-insights.com https://vitals.vercel-insights.com https://*.atlassian.com https://vercel.live https://*.vercel.live https://vercel.com https://*.vercel.app wss://*.vercel.app; frame-src https://drive.google.com https://*.google.com; frame-ancestors 'self'; form-action 'self'; base-uri 'self'; object-src 'none'`,
          },
        ],
      },
    ]
  },
}

const sentryConfig = {
  silent: true,
  org: env.SENTRY_ORG || '',
  project: env.SENTRY_PROJECT || '',
  authToken: env.SENTRY_AUTH_TOKEN || undefined,
  disableSourceMapUpload: env.NODE_ENV !== 'production',
  autoInstrumentServerFunctions: env.NODE_ENV === 'production',
  bundleSizeOptimizations: {
    excludeDebugStatements: true,
    excludePerformanceMonitoring: true,
    excludeReplayIframe: true,
    excludeReplayShadowDom: true,
    excludeReplayWorker: true,
  },
}

export default env.NODE_ENV === 'development'
  ? nextConfig
  : withSentryConfig(nextConfig, sentryConfig)
