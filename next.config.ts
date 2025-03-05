import type { NextConfig } from 'next'

// Check if we're building for standalone distribution
const isStandaloneBuild = process.env.USE_LOCAL_STORAGE === 'true'

const nextConfig: NextConfig = {
  devIndicators: false,
  images: {
    domains: ['avatars.githubusercontent.com'],
    // Enable static image optimization for standalone export
    unoptimized: isStandaloneBuild,
  },
  // Always use 'standalone' output to support API routes
  output: 'standalone',
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
                { key: 'Access-Control-Allow-Origin', value: 'https://localhost:3001' },
                { key: 'Access-Control-Allow-Methods', value: 'GET,POST,OPTIONS,PUT,DELETE' },
                {
                  key: 'Access-Control-Allow-Headers',
                  value:
                    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version',
                },
              ],
            },
            {
              // Cross-Origin Isolation headers (existing)
              source: '/:path*',
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
          ]
        },
      }),
}

export default nextConfig
