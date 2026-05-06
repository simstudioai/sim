import { FirefliesIcon } from '@/components/icons'
import type { TriggerConfig } from '@/triggers/types'

export const firefliesTranscriptionCompleteTrigger: TriggerConfig = {
  id: 'fireflies_transcription_complete',
  name: 'Fireflies Transcription Complete',
  provider: 'fireflies',
  description: 'Trigger workflow when a Fireflies meeting transcription is complete',
  version: '1.0.0',
  icon: FirefliesIcon,

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
    },
    {
      id: 'webhookSecret',
      title: 'Webhook Secret',
      type: 'short-input',
      placeholder: 'Enter your 16-32 character secret',
      description: 'Secret key for HMAC signature verification (set in Fireflies dashboard)',
      password: true,
      required: false,
      mode: 'trigger',
    },
    {
      id: 'triggerInstructions',
      title: 'Setup Instructions',
      hideFromPreview: true,
      type: 'text',
      defaultValue: [
        'Go to <a href="https://app.fireflies.ai/settings" target="_blank" rel="noopener noreferrer">app.fireflies.ai/settings</a>',
        'Navigate to the <strong>Developer settings</strong> tab',
        'In the <strong>Webhook</strong> or <strong>Webhooks V2</strong> section, paste the Webhook URL above',
        'Enter a <strong>Secret</strong> (16-32 characters) and save it here as well',
        'Click <strong>Save</strong> in Fireflies to activate the webhook',
        'Both Webhook V1 and V2 formats are supported automatically',
      ]
        .map(
          (instruction, index) =>
            `<div class="mb-3"><strong>${index + 1}.</strong> ${instruction}</div>`
        )
        .join(''),
      mode: 'trigger',
    },
  ],

  outputs: {
    meetingId: {
      type: 'string',
      description: 'The ID of the transcribed meeting',
    },
    eventType: {
      type: 'string',
      description: 'The type of event (e.g. Transcription completed, meeting.transcribed)',
    },
    clientReferenceId: {
      type: 'string',
      description: 'Custom reference ID if set during upload',
    },
    timestamp: {
      type: 'number',
      description: 'Unix timestamp in milliseconds when the event was fired (V2 webhooks)',
    },
  },

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-hub-signature': 'sha256=...',
    },
  },
}
