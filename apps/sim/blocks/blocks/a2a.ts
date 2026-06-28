import { A2AIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'

/**
 * @deprecated The A2A feature has been removed. This block is retained only as a
 * hidden, non-functional scaffold so workflows that still reference an `a2a`
 * block keep loading on the canvas instead of crashing on an unknown block type.
 * It has no tools, inputs, or outputs and cannot be added from the toolbar.
 */
export const A2ABlock: BlockConfig = {
  type: 'a2a',
  name: 'A2A',
  description: 'Deprecated. The A2A integration has been removed.',
  category: 'blocks',
  bgColor: '#4151B5',
  icon: A2AIcon,
  hideFromToolbar: true,
  subBlocks: [],
  tools: {
    access: [],
  },
  inputs: {},
  outputs: {},
}
