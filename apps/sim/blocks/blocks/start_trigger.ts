import { StartTriggerBlockDisplay } from '@/blocks/blocks/start_trigger.display'
import type { BlockConfig } from '@/blocks/types'

export const StartTriggerBlock: BlockConfig = {
  ...StartTriggerBlockDisplay,
  bestPractices: `
  - The Start block always exposes "input", "conversationId", and "files" fields for chat compatibility.
  - Add custom input format fields to collect additional structured data.
  - Test manual runs by pre-filling default values inside the input format fields.
  `,
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
