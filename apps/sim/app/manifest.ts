import type { MetadataRoute } from 'next'
import { getDeploymentEnv } from '@/lib/core/config/env-flags'
import { getBrandConfig, ICON_SETS } from '@/ee/whitelabeling'

export const dynamic = 'force-dynamic'

export default function manifest(): MetadataRoute.Manifest {
  const brand = getBrandConfig()
  const icons = ICON_SETS[getDeploymentEnv()]

  return {
    name:
      brand.name === 'Sim'
        ? 'Sim — The AI Workspace | Build, Deploy & Manage AI Agents'
        : brand.name,
    short_name: brand.name,
    description:
      'Sim is the open-source AI workspace where teams build, deploy, and manage AI agents. Connect 1,000+ integrations and every major LLM.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: brand.theme?.primaryColor || '#33C482',
    orientation: 'portrait-primary',
    // A whitelabeled deployment's install/home-screen icon should be the
    // tenant's own brand, not Sim's; otherwise it's the same per-environment
    // set as the HTML favicon slots in generateBrandedMetadata()
    // (ee/whitelabeling/metadata.ts), so a staging/dev PWA install doesn't
    // look like prod either.
    icons: brand.faviconUrl
      ? [{ src: brand.faviconUrl, sizes: 'any', type: 'image/png' }]
      : [
          { src: icons.android192, sizes: '192x192', type: 'image/png' },
          { src: icons.android512, sizes: '512x512', type: 'image/png' },
          { src: icons.apple, sizes: '180x180', type: 'image/png' },
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
