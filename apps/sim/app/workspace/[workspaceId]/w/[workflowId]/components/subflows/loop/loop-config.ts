import { Repeat } from '@/components/emcn/icons'

/**
 * Loop tool configuration for the toolbar.
 * Defines the visual appearance of the Loop subflow container in the toolbar.
 */
export const LoopTool = {
  type: 'loop',
  name: 'Loop',
  icon: Repeat,
  bgColor: '#2FB3FF',
  docsLink: 'https://docs.sim.ai/blocks/loop',
} as const
