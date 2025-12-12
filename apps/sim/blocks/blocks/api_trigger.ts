import { ApiIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'

export const ApiTriggerBlock: BlockConfig = {
  type: 'api_trigger',
  triggerAllowed: true,
  name: 'API (Legacy)',
  description: 'Legacy block for exposing HTTP API endpoint. Prefer Start block.',
  longDescription:
    'API trigger to start the workflow via authenticated HTTP calls with structured input.',
  bestPractices: `
  - Can run the workflow manually to test implementation when this is the trigger point.
  - The input format determines variables accesssible in the following blocks. E.g. <api1.paramName>. You can set the value in the input format to test the workflow manually.
  - In production, the curl would come in as e.g. curl -X POST -H "X-API-Key: $SIM_API_KEY" -H "Content-Type: application/json" -d '{"paramName":"example"}' https://www.staging.sim.ai/api/workflows/9e7e4f26-fc5e-4659-b270-7ea474b14f4a/execute -- If user asks to test via API, you might need to clarify the API key.
  `,
  category: 'triggers',
  hideFromToolbar: true,
  bgColor: '#2F55FF',
  icon: ApiIcon,
  subBlocks: [
    {
      id: 'inputFormat',
      title: 'Input Format',
      type: 'input-format',
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
