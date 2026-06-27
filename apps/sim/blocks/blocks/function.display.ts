import { CodeIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'

export const FunctionBlockDisplay = {
  type: 'function',
  name: 'Function',
  description: 'Run custom logic',
  category: 'blocks',
  bgColor: '#FF402F',
  icon: CodeIcon,
  longDescription:
    'This is a core workflow block. Execute custom JavaScript or Python code within your workflow. JavaScript without imports runs locally for fast execution, while code with imports or Python uses E2B sandbox.',
  docsLink: 'https://docs.sim.ai/workflows/blocks/function',
} satisfies BlockDisplay
