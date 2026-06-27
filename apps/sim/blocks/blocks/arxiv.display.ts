import { ArxivIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const ArxivBlockDisplay = {
  type: 'arxiv',
  name: 'ArXiv',
  description: 'Search and retrieve academic papers from ArXiv',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: ArxivIcon,
  longDescription:
    'Integrates ArXiv into the workflow. Can search for papers, get paper details, and get author papers. Does not require OAuth or an API key.',
  docsLink: 'https://docs.sim.ai/integrations/arxiv',
  integrationType: IntegrationType.Search,
} satisfies BlockDisplay
