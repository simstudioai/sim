import { JinaAIIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const JinaBlockDisplay = {
  type: 'jina',
  name: 'Jina',
  description: 'Search the web or extract content from URLs',
  category: 'tools',
  bgColor: '#333333',
  icon: JinaAIIcon,
  longDescription:
    'Integrate Jina AI into the workflow. Search the web and get LLM-friendly results, or extract clean content from specific URLs with advanced parsing options.',
  docsLink: 'https://docs.sim.ai/integrations/jina',
  integrationType: IntegrationType.Search,
} satisfies BlockDisplay
