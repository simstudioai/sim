import { ZepIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const ZepBlockDisplay = {
  type: 'zep',
  name: 'Zep',
  description: 'Long-term memory for AI agents',
  category: 'tools',
  bgColor: '#E8E8E8',
  icon: ZepIcon,
  longDescription:
    'Integrate Zep for long-term memory management. Create threads, add messages, retrieve context with AI-powered summaries and facts extraction.',
  docsLink: 'https://docs.sim.ai/integrations/zep',
  integrationType: IntegrationType.AI,
} satisfies BlockDisplay
