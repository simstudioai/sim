import { StartIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'

export const StarterBlockDisplay = {
  type: 'starter',
  name: 'Starter',
  description: 'Start workflow',
  category: 'blocks',
  bgColor: '#2FB3FF',
  icon: StartIcon,
  longDescription: 'Initiate your workflow manually with optional structured input.',
  hideFromToolbar: true,
} satisfies BlockDisplay
