import { HumanInTheLoopIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'

export const HumanInTheLoopBlockDisplay = {
  type: 'human_in_the_loop',
  name: 'Human in the Loop',
  description: 'Pause workflow execution and wait for human input',
  category: 'blocks',
  bgColor: '#10B981',
  icon: HumanInTheLoopIcon,
  longDescription:
    'Combines response and start functionality. Sends structured responses and allows workflow to resume from this point.',
  docsLink: 'https://docs.sim.ai/workflows/blocks/human-in-the-loop',
} satisfies BlockDisplay
