import { ConditionalIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'

export const ConditionBlockDisplay = {
  type: 'condition',
  name: 'Condition',
  description: 'Add a condition',
  category: 'blocks',
  bgColor: '#FF752F',
  icon: ConditionalIcon,
  longDescription:
    'This is a core workflow block. Add a condition to the workflow to branch the execution path based on a boolean expression.',
  docsLink: 'https://docs.sim.ai/workflows/blocks/condition',
} satisfies BlockDisplay
