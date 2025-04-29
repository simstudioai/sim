import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  devIndicators: false,
  images: {
    domains: [
      'avatars.githubusercontent.com',
      'oaidalleapiprodscus.blob.core.windows.net',
      'api.stability.ai',
    ]
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
                 value: "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' http://localhost:11434 http://host.docker.internal:11434; frame-ancestors 'self'; frame-ancestors 'self'; form-action 'self'; base-uri 'self'; object-src 'none'",
               },
             ],
           },
          ]
  },
}

export default nextConfig