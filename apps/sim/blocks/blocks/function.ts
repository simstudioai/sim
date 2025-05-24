import { CodeIcon } from '@/components/icons'
import { CodeExecutionOutput } from '@/tools/function/types'
import { BlockConfig } from '../types'

export const FunctionBlock: BlockConfig<CodeExecutionOutput> = {
  type: 'function',
  name: 'Function',
  description: 'Run custom logic',
  longDescription:
    'Execute custom JavaScript or TypeScript code within your workflow to transform data or implement complex logic. Create reusable functions to process inputs and generate outputs for other blocks.',
  docsLink: 'https://docs.simstudio.ai/blocks/function',
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
    access: ['function_execute'],
  },
  inputs: {
    code: { type: 'string', required: false },
    timeout: { type: 'number', required: false },
  },
  outputs: {
    response: {
      type: {
        result: 'any',
        stdout: 'string',
      },
    },
  },
}
