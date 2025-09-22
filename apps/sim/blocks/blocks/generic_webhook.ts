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

  outputs: {},

  triggers: {
    enabled: true,
    available: ['generic_webhook'],
  },
}
