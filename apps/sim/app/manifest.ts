import type { MetadataRoute } from 'next'
import { getBrandConfig } from '@/lib/branding/branding'

export default function manifest(): MetadataRoute.Manifest {
  const brand = getBrandConfig()

  return {
    name: brand.name,
    short_name: brand.name,
    description:
      'Build and deploy AI agents using our Figma-like canvas. Build, write evals, and deploy AI agent workflows that automate workflows and streamline your business processes.',
    start_url: '/',
    display: 'standalone',
    background_color: brand.primaryColor || '#ffffff',
    theme_color: brand.primaryColor || '#ffffff',
    icons: [
      {
        src: '/favicon/android-chrome-192x192.png',
        sizes: '192x192',
        type: 'image/png',
      },
      {
        src: '/favicon/android-chrome-512x512.png',
        sizes: '512x512',
        type: 'image/png',
      },
    ],
  }
}
