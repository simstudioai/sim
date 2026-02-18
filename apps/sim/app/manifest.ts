import type { MetadataRoute } from 'next'
import { getBrandConfig } from '@/ee/whitelabeling'

export default function manifest(): MetadataRoute.Manifest {
  const brand = getBrandConfig()

  return {
    name: brand.name === 'Sim' ? 'Sim — Build AI Agents & Run Your Agentic Workforce' : brand.name,
    short_name: brand.name,
    description:
      'Sim is the open-source platform to build AI agents and run your agentic workforce. Connect 1,000+ integrations and LLMs to orchestrate agentic workflows.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: brand.theme?.primaryColor || '#6F3DFA',
    orientation: 'portrait-primary',
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
      {
        src: '/favicon/apple-touch-icon.png',
        sizes: '180x180',
        type: 'image/png',
      },
    ],
    categories: ['productivity', 'developer', 'business'],
    shortcuts: [
      {
        name: 'Create Workflow',
        short_name: 'New',
        description: 'Create a new AI workflow',
        url: '/workspace',
      },
    ],
    lang: 'en-US',
    dir: 'ltr',
  }
}
