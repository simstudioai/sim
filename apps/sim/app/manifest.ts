import type { MetadataRoute } from 'next'
import { getBrandConfig } from '@/lib/branding/branding'

export default function manifest(): MetadataRoute.Manifest {
  const brand = getBrandConfig()

  return {
    name: brand.name === 'Sim' ? 'Sim - AI Agent Workflow Builder' : brand.name,
    short_name: brand.name,
    description:
      'Open-source AI agent workflow builder. 30,000+ developers build and deploy agentic workflows on Sim. Visual drag-and-drop interface for creating AI automations. SOC2 and HIPAA compliant.',
    start_url: '/',
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
        icons: [{ src: '/icons/new-workflow.png', sizes: '192x192' }],
      },
    ],
    lang: 'en-US',
    dir: 'ltr',
  }
}
