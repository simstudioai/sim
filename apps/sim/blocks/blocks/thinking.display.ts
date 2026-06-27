import { BrainIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'

export const ThinkingBlockDisplay = {
  type: 'thinking',
  name: 'Thinking',
  description: 'Forces model to outline its thought process.',
  category: 'blocks',
  bgColor: '#181C1E',
  icon: BrainIcon,
  longDescription:
    'Adds a step where the model explicitly outlines its thought process before proceeding. This can improve reasoning quality by encouraging step-by-step analysis.',
  docsLink: 'https://docs.sim.ai/integrations/thinking',
  hideFromToolbar: true,
} satisfies BlockDisplay
