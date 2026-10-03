import { Webhook } from '@sim/emcn/icons'
import type { BlockConfig } from '@/blocks/types'
import { getTrigger } from '@/triggers'

export const GenericWebhookBlock: BlockConfig = {
  type: 'generic_webhook',
  name: 'Webhook Trigger',
  description: 'Receive webhooks from any service by configuring a custom webhook.',
  category: 'triggers',
  icon: Webhook,
  bgColor: '#10B981', // Green color for triggers
  docsLink: 'https://docs.sim.ai/workflows/triggers/webhook',
  triggerAllowed: true,
  bestPractices: `
  - You can test the webhook by sending a request to the webhook URL. E.g. depending on authorization:  curl -X POST http://localhost:3000/api/webhooks/trigger/d8abcf0d-1ee5-4b77-bb07-b1e8142ea4e9 -H "Content-Type: application/json" -H "X-Sim-Secret: 1234" -d '{"message": "Test webhook trigger", "data": {"key": "v"}}'
  - Continuing example above, the body can be accessed in downstream block using dot notation. E.g. <webhooktrigger1.message> and <webhooktrigger1.data.key>
  - To deduplicate incoming events, set the Deduplication Field to a dot-notation path of a unique field in the payload (e.g. "event.id"). Duplicate values within 7 days will be skipped.
  - Only use when there's no existing integration for the service with triggerAllowed flag set to true.
  `,
  canvasPresentation: {
    defaultTitle: 'Webhook Trigger',
    /*
     * Every field here is plumbing — the URL, the auth token, the header name,
     * the acknowledgement. The one exception is the declared input schema,
     * which names what the caller is expected to send, so it rides along once
     * the user defines it.
     */
    triggerSentences: {
      default: ['Run on an incoming HTTP request', { text: ', carrying', field: 'inputFormat' }],
    },
  },

  subBlocks: [...getTrigger('generic_webhook').subBlocks],

  tools: {
    access: [], // No external tools needed for triggers
  },

  inputs: {}, // No inputs - webhook triggers receive data externally

  outputs: {},

  triggers: {
    enabled: true,
    available: ['generic_webhook'],
  },
}
