import { BrightDataIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const BrightDataBlockDisplay = {
  type: 'brightdata',
  name: 'Bright Data',
  description: 'Scrape websites, search engines, and extract structured data',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: BrightDataIcon,
  longDescription:
    'Integrate Bright Data into the workflow. Scrape any URL with Web Unlocker, search Google and other engines with SERP API, discover web content ranked by intent, or trigger pre-built scrapers for structured data extraction.',
  docsLink: 'https://docs.sim.ai/integrations/brightdata',
  integrationType: IntegrationType.Search,
} satisfies BlockDisplay
