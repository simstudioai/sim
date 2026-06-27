import { SearchIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const SearchBlockDisplay = {
  type: 'search',
  name: 'Search',
  description: 'Search the web ($0.01 per search)',
  category: 'blocks',
  bgColor: '#3B82F6',
  icon: SearchIcon,
  longDescription: 'Search the web using the Search tool. Each search costs $0.01 per query.',
  docsLink: 'https://docs.sim.ai/integrations/search',
  integrationType: IntegrationType.Search,
} satisfies BlockDisplay
