import { ConditionalIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'

interface ConditionBlockOutput {
  success: boolean
  output: {
    content: string
    conditionResult: boolean
    selectedPath: {
      blockId: string
      blockType: string
      blockTitle: string
    }
    selectedConditionId: string
  }
}

export const ConditionBlock: BlockConfig<ConditionBlockOutput> = {
  type: 'condition',
  name: 'Condition',
  description: 'Add a condition',
  longDescription:
    'Add a condition to the workflow to branch the execution path based on a boolean expression.',
  docsLink: 'https://docs.sim.ai/blocks/condition',
  bgColor: '#FF752F',
  icon: ConditionalIcon,
  category: 'blocks',
  subBlocks: [
    {
      id: 'conditions',
      type: 'condition-input',
      layout: 'full',
    },
  ],
  tools: {
    access: [],
  },
  inputs: {},
  outputs: {
    content: { type: 'string', description: 'Condition evaluation content' },
    conditionResult: { type: 'boolean', description: 'Condition result' },
    selectedPath: { type: 'json', description: 'Selected execution path' },
    selectedConditionId: { type: 'string', description: 'Selected condition identifier' },
  },
}
