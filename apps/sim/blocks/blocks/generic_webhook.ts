import type { SVGProps } from 'react'
import { createElement } from 'react'
import { Webhook } from 'lucide-react'
import type { BlockConfig } from '@/blocks/types'
import { getTrigger } from '@/triggers'

const WebhookIcon = (props: SVGProps<SVGSVGElement>) => createElement(Webhook, props)

export const GenericWebhookBlock: BlockConfig = {
  type: 'generic_webhook',
  name: 'Webhook',
  description: 'Receive webhooks from any service by configuring a custom webhook.',
  category: 'triggers',
  icon: WebhookIcon,
  bgColor: '#10B981', // Green color for triggers
  triggerAllowed: true,
  bestPractices: `
  - You can test the webhook by sending a request to the webhook URL. E.g. depending on authorization:  curl -X POST http://localhost:3000/api/webhooks/trigger/d8abcf0d-1ee5-4b77-bb07-b1e8142ea4e9 -H "Content-Type: application/json" -H "X-Sim-Secret: 1234" -d '{"message": "Test webhook trigger", "data": {"key": "v"}}'
  - Continuing example above, the body can be accessed in downstream block using dot notation. E.g. <webhook1.message> and <webhook1.data.key>
  - Only use when there's no existing integration for the service with triggerAllowed flag set to true.
  `,
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
