import { CodeIcon } from '@/components/icons'
import { CodeExecutionOutput } from '@/tools/function/execute'
import { BlockConfig } from '../types'

export const FunctionBlock: BlockConfig<CodeExecutionOutput> = {
  type: 'function',
  name: 'Function',
  description: 'Run custom logic',
  category: 'blocks',
  bgColor: '#FF402F',
  icon: CodeIcon,
  subBlocks: [
    {
      id: 'code',
      type: 'code',
      layout: 'full',
    },
  ],
  tools: {
    access: ['webcontainer_execute'],
  },
  inputs: {
    code: { type: 'string', required: true },
    timeout: { type: 'number', required: false },
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
