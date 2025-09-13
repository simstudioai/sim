import type { SVGProps } from 'react'
import { createElement } from 'react'
import { Webhook } from 'lucide-react'
import type { BlockConfig } from '@/blocks/types'

const WebhookIcon = (props: SVGProps<SVGSVGElement>) => createElement(Webhook, props)

export const GenericWebhookBlock: BlockConfig = {
  type: 'generic_webhook',
  name: 'Webhook',
  description: 'Receive webhooks from any service by configuring a custom webhook.',
  category: 'triggers',
  icon: WebhookIcon,
  bgColor: '#F97316', // Orange color for webhooks

  subBlocks: [
    // Generic webhook configuration - always visible
    {
      id: 'triggerConfig',
      title: 'Webhook Configuration',
      type: 'trigger-config',
      layout: 'full',
      triggerProvider: 'generic',
      availableTriggers: ['generic_webhook'],
    },
  ],

  tools: {
    access: [], // No external tools needed for triggers
  },

  inputs: {}, // No inputs - webhook triggers receive data externally

  outputs: {
    // Generic webhook outputs that can be used with any webhook payload
    payload: { type: 'json', description: 'Complete webhook payload' },
    headers: { type: 'json', description: 'Request headers' },
    method: { type: 'string', description: 'HTTP method' },
    url: { type: 'string', description: 'Request URL' },
    timestamp: { type: 'string', description: 'Webhook received timestamp' },
    // Common webhook fields that services often use
    event: { type: 'string', description: 'Event type from payload' },
    id: { type: 'string', description: 'Event ID from payload' },
    data: { type: 'json', description: 'Event data from payload' },
  },

  triggers: {
    enabled: true,
    available: ['generic_webhook'],
  },
}
