import { ApiIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'

export const ApiTriggerBlock: BlockConfig = {
  type: 'api_trigger',
  name: 'API',
  description: 'Expose as HTTP API endpoint',
  longDescription:
    'API trigger to start the workflow via authenticated HTTP calls with structured input.',
  category: 'triggers',
  bgColor: '#2F55FF',
  icon: ApiIcon,
  subBlocks: [
    {
      id: 'inputFormat',
      title: 'Input Format',
      type: 'input-format',
      layout: 'full',
      description: 'Define the JSON input schema accepted by the API endpoint.',
    },
  ],
  tools: {
    access: [],
  },
  inputs: {},
  outputs: {
    // Dynamic outputs will be added from inputFormat at runtime
    // Always includes 'input' field plus any fields defined in inputFormat
  },
  triggers: {
    enabled: true,
    available: ['api'],
  },
}
