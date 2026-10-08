import type { ContentSection } from '@/lib/content/seo'

export const CHANGELOG_SECTION = {
  name: 'Changelog',
  basePath: '/changelog',
  description:
    'New ways to build, deploy, and manage AI agents in Sim, plus improvements and fixes.',
  speakableSelectors: ['[itemprop="headline"]'],
} satisfies ContentSection

export const LATEST_ENTRY_LIMIT = 12
