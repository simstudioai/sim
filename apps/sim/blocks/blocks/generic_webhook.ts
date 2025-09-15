import { WebhookIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'

export const GenericWebhookBlock: BlockConfig = {
  type: 'generic_webhook',
  name: 'Webhook',
  description: 'Receive webhooks from any service by configuring a custom webhook.',
  category: 'triggers',
  icon: WebhookIcon,
  bgColor: '#10B981', // Green color for triggers

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
