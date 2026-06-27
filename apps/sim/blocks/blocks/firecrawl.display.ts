import { FirecrawlIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const FirecrawlBlockDisplay = {
  type: 'firecrawl',
  name: 'Firecrawl',
  description: 'Scrape, search, crawl, map, and extract web data',
  category: 'tools',
  bgColor: '#181C1E',
  icon: FirecrawlIcon,
  longDescription:
    'Integrate Firecrawl into the workflow. Scrape pages, search the web, crawl entire sites, map URL structures, and extract structured data with AI.',
  docsLink: 'https://docs.sim.ai/integrations/firecrawl',
  integrationType: IntegrationType.Search,
} satisfies BlockDisplay
