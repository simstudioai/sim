import { ContextDevIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const ContextDevBlockDisplay = {
  type: 'context_dev',
  name: 'Context.dev',
  description: 'Scrape, crawl, search, extract, and enrich web and brand data',
  category: 'tools',
  bgColor: '#ffffff',
  icon: ContextDevIcon,
  longDescription:
    'Integrate Context.dev into the workflow. Scrape pages to markdown or HTML, capture screenshots, list images, crawl entire sites, map sitemaps, search the web, extract structured data and products, pull design systems, classify industries, and retrieve brand assets by domain, name, email, ticker, or transaction — all from one API.',
  docsLink: 'https://docs.sim.ai/integrations/context_dev',
  integrationType: IntegrationType.Search,
} satisfies BlockDisplay
