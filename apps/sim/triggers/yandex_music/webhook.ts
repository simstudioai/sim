import type { TriggerConfig } from '@/triggers/types'

export const yandex_musicWebhookTrigger: TriggerConfig = {
  id: 'yandex_music_webhook',
  name: 'Yandex Music Webhook Webhook',
  provider: 'yandex_music',
  description:
    "Triggers when specific events occur within a user's Yandex Music account, such as playlist changes or track downloads.",
  version: '1.0.0',

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
      id: 'eventTypes',
      title: 'Event Types',
      type: 'dropdown',
      multiSelect: true,
      options: [
        { label: 'Playlist Updated', id: 'playlist:updated' },
        { label: 'Track Downloaded', id: 'track:downloaded' },
        { label: 'User Activity Logged', id: 'user:activity_log' },
      ],
      placeholder: 'Select events to listen for',
      description: 'Choose which events trigger this webhook.',
      mode: 'trigger',
    },

    {
      id: 'triggerInstructions',
      title: 'Setup Instructions',
      hideFromPreview: true,
      type: 'text',
      defaultValue: [
        '<div class="mb-3"><strong>1.</strong> Go to the Yandex Music Developer Dashboard.</div>',
        '<div class="mb-3"><strong>2.</strong> Create a new webhook endpoint and paste your system\'s receiving URL.</div>',
        '<div class="mb-3"><strong>3.</strong> Ensure the necessary scopes (e.g., playlist:write) are granted for event triggering.</div>',
      ].join(''),
      mode: 'trigger',
    },
  ],

  outputs: {
    event_type: {
      type: 'string',
      description: 'The specific type of event that occurred (e.g., playlist:updated).',
    },
    payload_json: {
      type: 'json',
      description: 'The full JSON payload containing details about the event.',
    },
  },

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
