import { GrainIcon } from '@/components/icons'
import type { TriggerConfig } from '@/triggers/types'
import { buildGenericOutputs, grainSetupInstructions, grainTriggerOptions } from './utils'

export const grainWebhookTrigger: TriggerConfig = {
  id: 'grain_webhook',
  name: 'Grain Webhook',
  provider: 'grain',
  description: 'Generic webhook trigger for all Grain events',
  version: '1.0.0',
  icon: GrainIcon,

  subBlocks: [
    {
      id: 'selectedTriggerId',
      title: 'Trigger Type',
      type: 'dropdown',
      mode: 'trigger',
      options: grainTriggerOptions,
      value: () => 'grain_webhook',
      required: true,
    },
    {
      id: 'webhookUrlDisplay',
      title: 'Webhook URL',
      type: 'short-input',
      readOnly: true,
      showCopyButton: true,
      useWebhookUrl: true,
      placeholder: 'Webhook URL will be generated',
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'grain_webhook',
      },
    },
    {
      id: 'webhookSecret',
      title: 'Webhook Secret',
      type: 'short-input',
      placeholder: 'Enter a strong secret',
      description: 'Validates that webhook deliveries originate from Grain.',
      password: true,
      required: false,
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'grain_webhook',
      },
    },
    {
      id: 'triggerInstructions',
      title: 'Setup Instructions',
      hideFromPreview: true,
      type: 'text',
      defaultValue: grainSetupInstructions('All events'),
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'grain_webhook',
      },
    },
    {
      id: 'triggerSave',
      title: '',
      type: 'trigger-save',
      hideFromPreview: true,
      mode: 'trigger',
      triggerId: 'grain_webhook',
      condition: {
        field: 'selectedTriggerId',
        value: 'grain_webhook',
      },
    },
  ],

  outputs: buildGenericOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
