import { GongIcon } from '@/components/icons'
import type { TriggerConfig } from '@/triggers/types'
import { buildGenericOutputs, gongSetupInstructions, gongTriggerOptions } from './utils'

/**
 * Gong Generic Webhook Trigger
 *
 * Primary trigger - includes the dropdown for selecting trigger type.
 * Accepts all webhook events from Gong automation rules.
 */
export const gongWebhookTrigger: TriggerConfig = {
  id: 'gong_webhook',
  name: 'Gong Webhook',
  provider: 'gong',
  description: 'Generic webhook trigger for all Gong events',
  version: '1.0.0',
  icon: GongIcon,

  subBlocks: [
    {
      id: 'selectedTriggerId',
      title: 'Trigger Type',
      type: 'dropdown',
      mode: 'trigger',
      options: gongTriggerOptions,
      value: () => 'gong_webhook',
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
        value: 'gong_webhook',
      },
    },
    {
      id: 'triggerSave',
      title: '',
      type: 'trigger-save',
      hideFromPreview: true,
      mode: 'trigger',
      triggerId: 'gong_webhook',
      condition: {
        field: 'selectedTriggerId',
        value: 'gong_webhook',
      },
    },
    {
      id: 'triggerInstructions',
      title: 'Setup Instructions',
      hideFromPreview: true,
      type: 'text',
      defaultValue: gongSetupInstructions('All Events'),
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'gong_webhook',
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
