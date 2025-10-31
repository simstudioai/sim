import { MicrosoftTeamsIcon } from '@/components/icons'
import type { TriggerConfig } from '@/triggers/types'

export const microsoftTeamsChatSubscriptionTrigger: TriggerConfig = {
  id: 'microsoftteams_chat_subscription',
  name: 'Microsoft Teams Chat',
  provider: 'microsoftteams',
  description:
    'Trigger workflow from new messages in Microsoft Teams chats via Microsoft Graph subscriptions',
  version: '1.0.0',
  icon: MicrosoftTeamsIcon,

  subBlocks: [
    {
      id: 'triggerCredentials',
      title: 'Credentials',
      type: 'oauth-input',
      description: 'This trigger requires microsoft teams credentials to access your account.',
      provider: 'microsoft-teams',
      requiredScopes: [],
      required: true,
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'microsoftteams_chat_subscription',
      },
    },
    {
      id: 'chatId',
      title: 'Chat ID',
      type: 'short-input',
      placeholder: 'Enter chat ID',
      description: 'The ID of the Teams chat to monitor',
      required: true,
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'microsoftteams_chat_subscription',
      },
    },
    {
      id: 'includeAttachments',
      title: 'Include Attachments',
      type: 'switch',
      defaultValue: true,
      description: 'Fetch hosted contents and upload to storage',
      required: false,
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'microsoftteams_chat_subscription',
      },
    },
    {
      id: 'triggerInstructions',
      title: 'Setup Instructions',
      type: 'text',
      defaultValue: [
        'Connect your Microsoft Teams account and grant the required permissions.',
        'Enter the Chat ID of the Teams chat you want to monitor.',
        'We will create a Microsoft Graph change notification subscription that delivers chat message events to your Sim webhook URL.',
      ]
        .map(
          (instruction, index) =>
            `<div class="mb-3"><strong>${index + 1}.</strong> ${instruction}</div>`
        )
        .join(''),
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'microsoftteams_chat_subscription',
      },
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
        value: 'microsoftteams_chat_subscription',
      },
    },
    {
      id: 'triggerSave',
      title: '',
      type: 'trigger-save',
      mode: 'trigger',
      triggerId: 'microsoftteams_chat_subscription',
      condition: {
        field: 'selectedTriggerId',
        value: 'microsoftteams_chat_subscription',
      },
    },
    {
      id: 'samplePayload',
      title: 'Event Payload Example',
      type: 'code',
      language: 'json',
      defaultValue: JSON.stringify(
        {
          message_id: '1708709741557',
          chat_id: '19:abcxyz@unq.gbl.spaces',
          from_name: 'Adele Vance',
          text: 'Hello from Teams!',
          created_at: '2025-01-01T10:00:00Z',
          attachments: [],
        },
        null,
        2
      ),
      readOnly: true,
      collapsible: true,
      defaultCollapsed: true,
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'microsoftteams_chat_subscription',
      },
    },
  ],

  outputs: {
    message_id: { type: 'string', description: 'Message ID' },
    chat_id: { type: 'string', description: 'Chat ID' },
    from_name: { type: 'string', description: 'Sender display name' },
    text: { type: 'string', description: 'Message body (HTML or text)' },
    created_at: { type: 'string', description: 'Message timestamp' },
    attachments: { type: 'file[]', description: 'Uploaded attachments as files' },
  },

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
