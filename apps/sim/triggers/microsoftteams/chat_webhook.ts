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

  // Credentials are handled by requiresCredentials below, not in configFields
  configFields: {
    chatId: {
      type: 'string',
      label: 'Chat ID',
      placeholder: 'Enter chat ID',
      description: 'The ID of the Teams chat to monitor',
      required: true,
    },
    includeAttachments: {
      type: 'boolean',
      label: 'Include Attachments',
      defaultValue: true,
      description: 'Fetch hosted contents and upload to storage',
      required: false,
    },
  },

  // Require Microsoft Teams OAuth credentials
  requiresCredentials: true,
  credentialProvider: 'microsoft-teams',
  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },

  outputs: {
    // Core message fields
    message_id: { type: 'string', description: 'Message ID' },
    chat_id: { type: 'string', description: 'Chat ID' },
    from_name: { type: 'string', description: 'Sender display name' },
    text: { type: 'string', description: 'Message body (HTML or text)' },
    created_at: { type: 'string', description: 'Message timestamp' },
    attachments: { type: 'json', description: 'Uploaded attachments metadata' },
  },

  instructions: [
    'Connect your Microsoft Teams account and grant the required permissions.',
    'Enter the Chat ID of the Teams chat you want to monitor.',
    'We will create a Microsoft Graph change notification subscription that delivers chat message events to your Sim webhook URL.',
  ],

  samplePayload: {
    message_id: '1708709741557',
    chat_id: '19:abcxyz@unq.gbl.spaces',
    from_name: 'Adele Vance',
    text: 'Hello from Teams!',
    created_at: '2025-01-01T10:00:00Z',
    attachments: [],
  },
}
