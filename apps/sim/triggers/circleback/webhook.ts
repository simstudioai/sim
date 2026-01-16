import { CirclebackIcon } from '@/components/icons'
import type { TriggerConfig } from '@/triggers/types'
import { buildMeetingOutputs, circlebackSetupInstructions, circlebackTriggerOptions } from './utils'

export const circlebackWebhookTrigger: TriggerConfig = {
  id: 'circleback_webhook',
  name: 'Circleback Webhook',
  provider: 'circleback',
  description: 'Generic webhook trigger for all Circleback events',
  version: '1.0.0',
  icon: CirclebackIcon,

  subBlocks: [
    {
      id: 'selectedTriggerId',
      title: 'Trigger Type',
      type: 'dropdown',
      mode: 'trigger',
      options: circlebackTriggerOptions,
      value: () => 'circleback_webhook',
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
        value: 'circleback_webhook',
      },
    },
    {
      id: 'webhookSecret',
      title: 'Signing Secret',
      type: 'short-input',
      placeholder: 'Paste signing secret from Circleback (optional)',
      description: 'Validates that webhook deliveries originate from Circleback using HMAC-SHA256.',
      password: true,
      required: false,
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'circleback_webhook',
      },
    },
    {
      id: 'triggerSave',
      title: '',
      type: 'trigger-save',
      hideFromPreview: true,
      mode: 'trigger',
      triggerId: 'circleback_webhook',
      condition: {
        field: 'selectedTriggerId',
        value: 'circleback_webhook',
      },
    },
    {
      id: 'triggerInstructions',
      title: 'Setup Instructions',
      hideFromPreview: true,
      type: 'text',
      defaultValue: circlebackSetupInstructions('All events'),
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'circleback_webhook',
      },
    },
  ],

  outputs: buildMeetingOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
