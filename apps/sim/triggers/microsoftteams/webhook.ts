import { MicrosoftTeamsIcon } from '@/components/icons'
import type { TriggerConfig } from '../types'

export const microsoftTeamsWebhookTrigger: TriggerConfig = {
  id: 'microsoftteams_webhook',
  name: 'Microsoft Teams Channel',
  provider: 'microsoft-teams',
  description: 'Trigger workflow from Microsoft Teams channel messages via outgoing webhooks',
  version: '1.0.0',
  icon: MicrosoftTeamsIcon,

  subBlocks: [
    {
      id: 'selectedTriggerId',
      title: 'Trigger Type',
      type: 'dropdown',
      mode: 'trigger',
      options: [
        { label: 'Microsoft Teams Channel', id: 'microsoftteams_webhook' },
        { label: 'Microsoft Teams Chat', id: 'microsoftteams_chat_subscription' },
      ],
      value: () => 'microsoftteams_webhook',
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
        value: 'microsoftteams_webhook',
      },
    },
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
      condition: {
        field: 'selectedTriggerId',
        value: 'microsoftteams_webhook',
      },
    },
    {
      id: 'triggerInstructions',
      title: 'Setup Instructions',
      hideFromPreview: true,
      type: 'text',
      defaultValue: [
        'Open Microsoft Teams and go to the team where you want to add the webhook.',
        'Click the three dots (•••) next to the team name and select "Manage team".',
        'Go to the "Apps" tab and click "Create an outgoing webhook".',
        'Provide a name, description, and optionally a profile picture.',
        'Set the callback URL to your Sim webhook URL above.',
        'Copy the HMAC security token and paste it into the "HMAC Secret" field.',
        'Click "Create" to finish setup.',
      ]
        .map(
          (instruction, index) =>
            `<div class="mb-3"><strong>${index + 1}.</strong> ${instruction}</div>`
        )
        .join(''),
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'microsoftteams_webhook',
      },
    },
    {
      id: 'triggerSave',
      title: '',
      type: 'trigger-save',
      hideFromPreview: true,
      mode: 'trigger',
      triggerId: 'microsoftteams_webhook',
      condition: {
        field: 'selectedTriggerId',
        value: 'microsoftteams_webhook',
      },
    },
  ],

  outputs: {
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
