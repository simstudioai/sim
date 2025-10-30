import { MicrosoftTeamsIcon } from '@/components/icons'
import type { TriggerConfig } from '../types'

export const microsoftTeamsWebhookTrigger: TriggerConfig = {
  id: 'microsoftteams_webhook',
  name: 'Microsoft Teams Channel',
  provider: 'microsoftteams',
  description: 'Trigger workflow from Microsoft Teams channel messages via outgoing webhooks',
  version: '1.0.0',
  icon: MicrosoftTeamsIcon,

  subBlocks: [
    // HMAC Secret
    {
      id: 'hmacSecret',
      title: 'HMAC Secret',
      type: 'short-input',
      placeholder: 'Enter HMAC secret from Teams',
      description:
        'The security token provided by Teams when creating an outgoing webhook. Used to verify request authenticity.',
      password: true,
      required: true,
      mode: 'trigger',
    },
    // Setup Instructions
    {
      id: 'triggerInstructions',
      title: 'Setup Instructions',
      type: 'text',
      defaultValue: [
        'Open Microsoft Teams and go to the team where you want to add the webhook.',
        'Click the three dots (•••) next to the team name and select "Manage team".',
        'Go to the "Apps" tab and click "Create an outgoing webhook".',
        'Provide a name, description, and optionally a profile picture.',
        'Set the callback URL to your Sim webhook URL.',
        'Copy the HMAC security token and paste it into the "HMAC Secret" field.',
        'Click "Create" to finish setup.',
      ]
        .map(
          (instruction, index) =>
            `<div class="mb-3"><strong>${index + 1}.</strong> ${instruction}</div>`
        )
        .join(''),
      mode: 'trigger',
    },
    // Webhook URL
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
    // Save Button
    {
      id: 'triggerSave',
      title: '',
      type: 'trigger-save',
      mode: 'trigger',
      triggerId: 'microsoftteams_webhook',
    },
    // Sample Payload
    {
      id: 'samplePayload',
      title: 'Event Payload Example',
      type: 'code',
      language: 'json',
      defaultValue: JSON.stringify(
        {
          type: 'message',
          id: '1234567890',
          timestamp: '2023-01-01T00:00:00.000Z',
          localTimestamp: '2023-01-01T00:00:00.000Z',
          serviceUrl: 'https://smba.trafficmanager.net/amer/',
          channelId: 'msteams',
          from: {
            id: '29:1234567890abcdef',
            name: 'John Doe',
          },
          conversation: {
            id: '19:meeting_abcdef@thread.v2',
          },
          text: 'Hello Sim Bot!',
        },
        null,
        2
      ),
      readOnly: true,
      collapsible: true,
      defaultCollapsed: true,
      mode: 'trigger',
    },
  ],

  outputs: {
    // Top-level valid payloads only
    from: {
      id: { type: 'string', description: 'Sender ID' },
      name: { type: 'string', description: 'Sender name' },
      aadObjectId: { type: 'string', description: 'AAD Object ID' },
    },
    message: {
      raw: {
        attachments: { type: 'array', description: 'Array of attachments' },
        channelData: {
          team: { id: { type: 'string', description: 'Team ID' } },
          tenant: { id: { type: 'string', description: 'Tenant ID' } },
          channel: { id: { type: 'string', description: 'Channel ID' } },
          teamsTeamId: { type: 'string', description: 'Teams team ID' },
          teamsChannelId: { type: 'string', description: 'Teams channel ID' },
        },
        conversation: {
          id: { type: 'string', description: 'Composite conversation ID' },
          name: { type: 'string', description: 'Conversation name (nullable)' },
          isGroup: { type: 'boolean', description: 'Is group conversation' },
          tenantId: { type: 'string', description: 'Tenant ID' },
          aadObjectId: { type: 'string', description: 'AAD Object ID (nullable)' },
          conversationType: { type: 'string', description: 'Conversation type (channel)' },
        },
        text: { type: 'string', description: 'Message text content' },
        messageType: { type: 'string', description: 'Message type' },
        channelId: { type: 'string', description: 'Channel ID (msteams)' },
        timestamp: { type: 'string', description: 'Timestamp' },
      },
    },
    activity: { type: 'object', description: 'Activity payload' },
    conversation: {
      id: { type: 'string', description: 'Composite conversation ID' },
      name: { type: 'string', description: 'Conversation name (nullable)' },
      isGroup: { type: 'boolean', description: 'Is group conversation' },
      tenantId: { type: 'string', description: 'Tenant ID' },
      aadObjectId: { type: 'string', description: 'AAD Object ID (nullable)' },
      conversationType: { type: 'string', description: 'Conversation type (channel)' },
    },
  },

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
