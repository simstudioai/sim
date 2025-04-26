import type { NextConfig } from 'next'

// Check if we're building for standalone distribution
const isStandaloneBuild = process.env.USE_LOCAL_STORAGE === 'true'

const nextConfig: NextConfig = {
  devIndicators: false,
  crossOrigin: 'anonymous',
  experimental: {
    sri: {
      algorithm: 'sha256'
    }
  },
  images: {
    domains: [
      'avatars.githubusercontent.com',
      'oaidalleapiprodscus.blob.core.windows.net',
      'api.stability.ai',
    ],
    // Enable static image optimization for standalone export
    unoptimized: isStandaloneBuild,
  },
  // Always use 'standalone' output to support API routes
  output: 'standalone',
  webpack: (config, { isServer }) => {
    // Configure webpack to use memory cache instead of filesystem cache
    // This avoids the serialization of large strings during the build process
    if (config.cache) {
      config.cache = {
        type: 'memory',
        maxGenerations: 1,
      }
    }

    return config
  },
  // Only include headers when not building for standalone export
  ...(isStandaloneBuild
    ? {}
    : {
        async headers() {
          return [
            {
              // API routes CORS headers
              source: '/api/:path*',
              headers: [
                { key: 'Access-Control-Allow-Credentials', value: 'true' },
                {
                  key: 'Access-Control-Allow-Origin',
                  value: 'https://localhost:3001',
                },
                {
                  key: 'Access-Control-Allow-Methods',
                  value: 'GET,POST,OPTIONS,PUT,DELETE',
                },
                {
                  key: 'Access-Control-Allow-Headers',
                  value:
                    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version',
                },
                {
                  key: 'Cache-Control',
                  value: 'no-store, no-cache, must-revalidate, proxy-revalidate',
                },
                {
                  key: 'Pragma',
                  value: 'no-cache',
                },
                {
                  key: 'Expires',
                  value: '0',
                },
                {
                  key: 'Surrogate-Control',
                  value: 'no-store',
                },
              ],
            },
            {
              // Apply security headers to all routes
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
                  value: "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; frame-ancestors 'self'; form-action 'self'; base-uri 'self'; object-src 'none'",
                },
                {
                  key: 'Cache-Control',
                  value: 'no-store, no-cache, must-revalidate, proxy-revalidate',
                },
                {
                  key: 'Pragma',
                  value: 'no-cache',
                },
                {
                  key: 'Expires',
                  value: '0',
                },
                {
                  key: 'Surrogate-Control',
                  value: 'no-store',
                },
                {
                  key: 'Vary',
                  value: 'User-Agent',
                },
              ],
            },
            {
              // Dynamic routes containing user data - strict no caching
              source: '/w/:path*',
              headers: [
                {
                  key: 'Cache-Control',
                  value: 'private, no-store, no-cache, must-revalidate, proxy-revalidate',
                },
                {
                  key: 'Pragma',
                  value: 'no-cache',
                },
                {
                  key: 'Expires',
                  value: '0',
                },
                {
                  key: 'Surrogate-Control',
                  value: 'no-store',
                },
              ],
            },
            {
              // Apply Cross-Origin Isolation headers to all routes except those that use the Google Drive Picker
              source: '/((?!w/.*|api/auth/oauth/drive).*)',
              headers: [
                {
                  key: 'Cross-Origin-Embedder-Policy',
                  value: 'require-corp',
                },
                {
                  key: 'Cross-Origin-Opener-Policy',
                  value: 'same-origin',
                },
              ],
            },
            {
              // For routes that use the Google Drive Picker, only apply COOP but not COEP
              source: '/(w/.*|api/auth/oauth/drive)',
              headers: [
                {
                  key: 'Cross-Origin-Opener-Policy',
                  value: 'same-origin',
                },
              ],
            },
          ]
        },
      }),
}

export default nextConfig
