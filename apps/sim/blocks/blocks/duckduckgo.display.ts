import { DuckDuckGoIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const DuckDuckGoBlockDisplay = {
  type: 'duckduckgo',
  name: 'DuckDuckGo',
  description: 'Search with DuckDuckGo',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: DuckDuckGoIcon,
  longDescription:
    'Search the web using DuckDuckGo Instant Answers API. Returns instant answers, abstracts, related topics, and more. Free to use without an API key.',
  docsLink: 'https://docs.sim.ai/integrations/duckduckgo',
  integrationType: IntegrationType.Search,
} satisfies BlockDisplay
