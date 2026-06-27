import { Mem0Icon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const Mem0BlockDisplay = {
  type: 'mem0',
  name: 'Mem0',
  description: 'Agent memory management',
  category: 'tools',
  bgColor: '#181C1E',
  icon: Mem0Icon,
  longDescription: 'Integrate Mem0 into the workflow. Can add, search, and retrieve memories.',
  docsLink: 'https://docs.sim.ai/integrations/mem0',
  integrationType: IntegrationType.AI,
} satisfies BlockDisplay
