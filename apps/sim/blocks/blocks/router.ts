import { ConnectIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import type { ToolResponse } from '@/tools/types'

interface RouterResponse extends ToolResponse {
  output: {
    conditionResult: boolean
    selectedPath: {
      blockId: string
      blockType: string
      blockTitle: string
    }
    selectedOption: string
  }
}

export const RouterBlock: BlockConfig<RouterResponse> = {
  type: 'router',
  name: 'Router',
  description: 'Route workflow',
  longDescription:
    'This is a core workflow block. Intelligently direct workflow execution to different paths based on conditional logic. Define conditions to evaluate and route to different blocks.',
  bestPractices: `
  - Write the conditions using standard javascript syntax, referencing outputs of previous blocks using <> syntax.
  - The first matching condition will be selected, otherwise the else route is taken.
  - Can reference workflow variables using <blockName.output> syntax within conditions.
  `,
  docsLink: 'https://docs.sim.ai/blocks/router',
  category: 'blocks',
  bgColor: '#28C43F',
  icon: ConnectIcon,
  subBlocks: [
    {
      id: 'routes',
      type: 'router-input',
    },
  ],
  tools: {
    access: [],
  },
  inputs: {},
  outputs: {
    conditionResult: { type: 'boolean', description: 'Whether a condition matched' },
    selectedPath: { type: 'json', description: 'Selected routing path' },
    selectedOption: { type: 'string', description: 'Selected route option ID' },
  },
}
