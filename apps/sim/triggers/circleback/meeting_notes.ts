import { CirclebackIcon } from '@/components/icons'
import type { TriggerConfig } from '@/triggers/types'
import { buildMeetingOutputs, circlebackSetupInstructions } from './utils'

export const circlebackMeetingNotesTrigger: TriggerConfig = {
  id: 'circleback_meeting_notes',
  name: 'Circleback Meeting Notes Ready',
  provider: 'circleback',
  description: 'Trigger workflow when meeting notes and action items are ready',
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
        value: 'circleback_meeting_notes',
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
        value: 'circleback_meeting_notes',
      },
    },
    {
      id: 'triggerSave',
      title: '',
      type: 'trigger-save',
      hideFromPreview: true,
      mode: 'trigger',
      triggerId: 'circleback_meeting_notes',
      condition: {
        field: 'selectedTriggerId',
        value: 'circleback_meeting_notes',
      },
    },
    {
      id: 'triggerInstructions',
      title: 'Setup Instructions',
      hideFromPreview: true,
      type: 'text',
      defaultValue: circlebackSetupInstructions('Meeting notes and action items'),
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'circleback_meeting_notes',
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
