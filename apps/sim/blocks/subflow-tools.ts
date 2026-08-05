import { Repeat, Split } from '@sim/emcn/icons'

/**
 * Visual identity of the two subflow containers.
 *
 * Lives with the block registry rather than inside the workflow editor because
 * both the editor's toolbar and the log view's trace renderer need it, and a
 * shared leaf under `app/workspace/[workspaceId]/**` is exactly the shape that
 * makes a workspace-nested module read as importable from anywhere.
 */
export const LoopTool = {
  type: 'loop',
  name: 'Loop',
  icon: Repeat,
  bgColor: '#2FB3FF',
  docsLink: 'https://docs.sim.ai/workflows/blocks/loop',
} as const

export const ParallelTool = {
  type: 'parallel',
  name: 'Parallel',
  icon: Split,
  bgColor: '#FEE12B',
  docsLink: 'https://docs.sim.ai/workflows/blocks/parallel',
} as const
