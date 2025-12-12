import { StartIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'

export const StartTriggerBlock: BlockConfig = {
  type: 'start_trigger',
  triggerAllowed: true,
  name: 'Start',
  description: 'Unified workflow entry point for chat, manual and API runs',
  longDescription:
    'Collect structured inputs and power manual runs, API executions, and deployed chat experiences from a single start block.',
  bestPractices: `
  - The Start block always exposes "input", "conversationId", and "files" fields for chat compatibility.
  - Add custom input format fields to collect additional structured data.
  - Test manual runs by pre-filling default values inside the input format fields.
  `,
  category: 'triggers',
  bgColor: '#34B5FF',
  icon: StartIcon,
  hideFromToolbar: false,
  subBlocks: [
    {
      id: 'inputFormat',
      title: 'Inputs',
      type: 'input-format',
      description: 'Add custom fields beyond the built-in input, conversationId, and files fields.',
    },
  ],
  tools: {
    access: [],
  },
  inputs: {},
  outputs: {},
  triggers: {
    enabled: true,
    available: ['chat', 'manual', 'api'],
  },
}
