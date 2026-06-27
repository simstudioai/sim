import { ExaAIIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const ExaBlockDisplay = {
  type: 'exa',
  name: 'Exa',
  description: 'Search with Exa AI',
  category: 'tools',
  bgColor: '#1F40ED',
  icon: ExaAIIcon,
  iconColor: '#1F40ED',
  longDescription:
    'Integrate Exa into the workflow. Can search, get contents, find similar links, answer a question, and perform research.',
  docsLink: 'https://docs.sim.ai/integrations/exa',
  integrationType: IntegrationType.Search,
} satisfies BlockDisplay
