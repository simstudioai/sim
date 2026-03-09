import { CirclebackIcon } from '@/components/icons'
import type { TriggerConfig } from '@/triggers/types'
import { buildMeetingOutputs, circlebackSetupInstructions } from './utils'

export const circlebackMeetingCompletedTrigger: TriggerConfig = {
  id: 'circleback_meeting_completed',
  name: 'Circleback Meeting Completed',
  provider: 'circleback',
  description: 'Trigger workflow when a meeting is processed and ready in Circleback',
  version: '1.0.0',
  icon: CirclebackIcon,

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
        value: 'circleback_meeting_completed',
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
        value: 'circleback_meeting_completed',
      },
    },
    {
      id: 'triggerSave',
      title: '',
      type: 'trigger-save',
      hideFromPreview: true,
      mode: 'trigger',
      triggerId: 'circleback_meeting_completed',
      condition: {
        field: 'selectedTriggerId',
        value: 'circleback_meeting_completed',
      },
    },
    {
      id: 'triggerInstructions',
      title: 'Setup Instructions',
      hideFromPreview: true,
      type: 'text',
      defaultValue: circlebackSetupInstructions('All meeting data'),
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'circleback_meeting_completed',
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
