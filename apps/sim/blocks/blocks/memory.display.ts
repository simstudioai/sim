import { BrainIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'

export const MemoryBlockDisplay = {
  type: 'memory',
  name: 'Memory',
  description: 'Add memory store',
  category: 'blocks',
  bgColor: '#F64F9E',
  icon: BrainIcon,
  longDescription:
    'Integrate Memory into the workflow. Can add, get a memory, get all memories, and delete memories.',
  docsLink: 'https://docs.sim.ai/integrations/memory',
} satisfies BlockDisplay
