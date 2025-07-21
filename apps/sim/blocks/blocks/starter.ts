import { StartIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'

export const StarterBlock: BlockConfig = {
  type: 'starter',
  name: 'Starter',
  description: 'Start workflow',
  longDescription: 'Initiate your workflow manually with optional structured input for API calls.',
  category: 'blocks',
  bgColor: '#2FB3FF',
  icon: StartIcon,
  subBlocks: [
    // Main trigger selector
    {
      id: 'startWorkflow',
      title: 'Start Workflow',
      type: 'dropdown',
      layout: 'full',
      options: [
        { label: 'Run manually', id: 'manual' },
        { label: 'Chat', id: 'chat' },
      ],
      value: () => 'manual',
    },
    // Structured Input format - visible if manual run is selected (advanced mode)
    {
      id: 'inputFormat',
      title: 'Input Format (for API calls)',
      type: 'input-format',
      layout: 'full',
      mode: 'advanced',
      condition: { field: 'startWorkflow', value: 'manual' },
    },
  ],
  tools: {
    access: [],
  },
  inputs: {
    input: { type: 'json', required: false },
  },
  outputs: {},
}
