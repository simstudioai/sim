import { Split } from '@/components/emcn/icons'

/**
 * Parallel tool configuration for the toolbar.
 * Defines the visual appearance of the Parallel subflow container in the toolbar.
 */
export const ParallelTool = {
  type: 'parallel',
  name: 'Parallel',
  icon: Split,
  bgColor: '#FEE12B',
  docsLink: 'https://docs.sim.ai/workflows/blocks/parallel',
} as const
