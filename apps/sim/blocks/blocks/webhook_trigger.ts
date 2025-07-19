import { SignalIcon } from '@/components/icons'
import type { BlockConfig } from '../types'

export const WebhookTriggerBlock: BlockConfig = {
  type: 'webhook_trigger',
  name: 'Webhook Trigger',
  description: 'Trigger workflow execution from external webhooks',
  category: 'blocks',
  icon: SignalIcon,
  bgColor: '#10B981', // Green color for triggers

  subBlocks: [
    {
      id: 'webhookProvider',
      title: 'Webhook Provider',
      type: 'dropdown',
      layout: 'full',
      options: [
        { label: 'Slack', id: 'slack' },
        { label: 'Gmail', id: 'gmail' },
        { label: 'Airtable', id: 'airtable' },
        { label: 'Telegram', id: 'telegram' },
        { label: 'Generic', id: 'generic' },
        { label: 'WhatsApp', id: 'whatsapp' },
        { label: 'GitHub', id: 'github' },
        { label: 'Discord', id: 'discord' },
        { label: 'Stripe', id: 'stripe' },
      ],
      value: () => 'generic',
    },
    {
      id: 'webhookConfig',
      title: 'Webhook Configuration',
      type: 'webhook-config',
      layout: 'full',
    },
  ],

  tools: {
    access: [], // No external tools needed
  },

  inputs: {}, // No inputs - webhook triggers are pure input sources

  outputs: {}, // No outputs - webhook data is injected directly into workflow context
}
