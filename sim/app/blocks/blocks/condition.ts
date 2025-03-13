import { ConditionalIcon } from '@/components/icons'
import { CodeExecutionOutput } from '@/tools/function/execute'
import { BlockConfig } from '../types'

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
  bgColor: '#FF972F',
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
    access: ['function_execute'],
  },
  inputs: {
    code: { type: 'string', required: true },
  },
  outputs: {
    response: {
      type: {
        content: 'string',
        conditionResult: 'boolean',
        selectedPath: 'json',
        selectedConditionId: 'string',
      },
    },
  },
}
