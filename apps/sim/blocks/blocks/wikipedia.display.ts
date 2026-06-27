import { WikipediaIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const WikipediaBlockDisplay = {
  type: 'wikipedia',
  name: 'Wikipedia',
  description: 'Search and retrieve content from Wikipedia',
  category: 'tools',
  bgColor: '#000000',
  icon: WikipediaIcon,
  longDescription:
    'Integrate Wikipedia into the workflow. Can get page summary, search pages, get page content, and get random page.',
  docsLink: 'https://docs.sim.ai/integrations/wikipedia',
  integrationType: IntegrationType.Search,
} satisfies BlockDisplay
