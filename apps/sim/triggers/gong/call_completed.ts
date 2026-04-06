import { GongIcon } from '@/components/icons'
import type { TriggerConfig } from '@/triggers/types'
import { buildCallOutputs, gongSetupInstructions } from './utils'

/**
 * Gong Call Completed Trigger
 *
 * Secondary trigger - does NOT include the dropdown (the generic webhook trigger has it).
 * Fires when a call matching the configured rule is processed in Gong.
 */
export const gongCallCompletedTrigger: TriggerConfig = {
  id: 'gong_call_completed',
  name: 'Gong Call Completed',
  provider: 'gong',
  description: 'Trigger workflow when a call is completed and processed in Gong',
  version: '1.0.0',
  icon: GongIcon,

  subBlocks: [
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
        value: 'gong_call_completed',
      },
    },
    {
      id: 'triggerSave',
      title: '',
      type: 'trigger-save',
      hideFromPreview: true,
      mode: 'trigger',
      triggerId: 'gong_call_completed',
      condition: {
        field: 'selectedTriggerId',
        value: 'gong_call_completed',
      },
    },
    {
      id: 'triggerInstructions',
      title: 'Setup Instructions',
      hideFromPreview: true,
      type: 'text',
      defaultValue: gongSetupInstructions('Call Completed'),
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'gong_call_completed',
      },
    },
  ],

  outputs: buildCallOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
