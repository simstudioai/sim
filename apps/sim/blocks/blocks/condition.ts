import { ConditionBlockDisplay } from '@/blocks/blocks/condition.display'
import type { BlockConfig } from '@/blocks/types'

interface ConditionBlockOutput {
  success: boolean
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

export const ConditionBlock: BlockConfig<ConditionBlockOutput> = {
  ...ConditionBlockDisplay,
  bestPractices: `
  - Write the conditions using standard javascript syntax except referencing the outputs of previous blocks using <> syntax, and keep them as simple as possible. No hacky fallbacks.
  - Can reference workflow variables using <blockName.output> syntax as usual within conditions.
  `,
  subBlocks: [
    {
      id: 'conditions',
      type: 'condition-input',
    },
  ],
  tools: {
    access: [],
  },
  inputs: {},
  outputs: {
    conditionResult: { type: 'boolean', description: 'Condition result' },
    selectedPath: { type: 'json', description: 'Selected execution path' },
    selectedOption: { type: 'string', description: 'Selected condition option ID' },
  },
}
