import { TavilyIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const TavilyBlockDisplay = {
  type: 'tavily',
  name: 'Tavily',
  description: 'Search and extract information',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: TavilyIcon,
  longDescription:
    'Integrate Tavily into the workflow. Can search the web and extract content from specific URLs. Requires API Key.',
  docsLink: 'https://docs.sim.ai/integrations/tavily',
  integrationType: IntegrationType.Search,
} satisfies BlockDisplay
