import { ConditionalIcon } from '@/components/icons'
import { CodeExecutionOutput } from '@/tools/function/execute'
import { BlockConfig } from '../types'

export const ConditionBlock: BlockConfig<CodeExecutionOutput> = {
  type: 'condition',
  name: 'Condition',
  description: 'Add a condition',
  longDescription: 'Add a condition to the workflow',
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
        result: 'any',
        stdout: 'string',
        executionTime: 'number',
      },
    },
  },
}
