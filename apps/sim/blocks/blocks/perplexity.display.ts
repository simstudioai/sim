import { PerplexityIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const PerplexityBlockDisplay = {
  type: 'perplexity',
  name: 'Perplexity',
  description: 'Use Perplexity AI for chat and search',
  category: 'tools',
  bgColor: '#20808D',
  icon: PerplexityIcon,
  iconColor: '#20808D',
  longDescription:
    'Integrate Perplexity into the workflow. Can generate completions using Perplexity AI chat models or perform web searches with advanced filtering.',
  docsLink: 'https://docs.sim.ai/integrations/perplexity',
  integrationType: IntegrationType.AI,
} satisfies BlockDisplay
