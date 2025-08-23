import { MicrosoftTeamsIcon } from '@/components/icons'
import type { TriggerConfig } from '../types'

export const microsoftTeamsWebhookTrigger: TriggerConfig = {
  id: 'microsoftteams_webhook',
  name: 'Microsoft Teams Webhook',
  provider: 'microsoftteams',
  description: 'Trigger workflow from Microsoft Teams events like messages and mentions',
  version: '1.0.0',
  icon: MicrosoftTeamsIcon,

  configFields: {
    hmacSecret: {
      type: 'string',
      label: 'HMAC Secret',
      placeholder: 'Enter HMAC secret from Teams',
      description:
        'The security token provided by Teams when creating an outgoing webhook. Used to verify request authenticity.',
      required: true,
      isSecret: true,
    },
  },

  outputs: {
    // Expose the raw Teams message payload at the root for direct access
    id: { type: 'string', description: 'Raw message ID' },
    code: { type: 'string', description: 'Code (nullable)' },
    from: {
      id: { type: 'string', description: 'Sender ID' },
      name: { type: 'string', description: 'Sender name' },
      role: { type: 'string', description: 'Sender role (nullable)' },
      aadObjectId: { type: 'string', description: 'AAD Object ID' },
    },
    name: { type: 'string', description: 'Top-level name (nullable)' },
    text: { type: 'string', description: 'Message HTML content' },
    label: { type: 'string', description: 'Label (nullable)' },
    speak: { type: 'string', description: 'Speak (nullable)' },
    value: { type: 'string', description: 'Value (nullable)' },
    action: { type: 'string', description: 'Action (nullable)' },
    locale: { type: 'string', description: 'Locale (e.g., en-US)' },
    summary: { type: 'string', description: 'Summary (nullable)' },
    callerId: { type: 'string', description: 'Caller ID' },
    entities: { type: 'array', description: 'Array of entities (clientInfo, ...)' },
    channelId: { type: 'string', description: 'Channel ID (msteams)' },
    inputHint: { type: 'string', description: 'Input hint (nullable)' },
    listenFor: { type: 'string', description: 'Listen for (nullable)' },
    recipient: { type: 'string', description: 'Recipient (nullable)' },
    relatesTo: { type: 'string', description: 'RelatesTo (nullable)' },
    replyToId: { type: 'string', description: 'Reply to ID (nullable)' },
    timestamp: { type: 'string', description: 'Timestamp' },
    topicName: { type: 'string', description: 'Topic name (nullable)' },
    valueType: { type: 'string', description: 'Value type (nullable)' },
    expiration: { type: 'string', description: 'Expiration (nullable)' },
    importance: { type: 'string', description: 'Importance (nullable)' },
    serviceUrl: { type: 'string', description: 'Service URL' },
    textFormat: { type: 'string', description: 'Text format (plain)' },
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
      role: { type: 'string', description: 'Conversation role (nullable)' },
      isGroup: { type: 'boolean', description: 'Is group conversation' },
      tenantId: { type: 'string', description: 'Tenant ID' },
      aadObjectId: { type: 'string', description: 'AAD Object ID (nullable)' },
      conversationType: { type: 'string', description: 'Conversation type (channel)' },
    },
    deliveryMode: { type: 'string', description: 'Delivery mode (nullable)' },
    membersAdded: { type: 'array', description: 'Members added (nullable)' },
    localTimezone: { type: 'string', description: 'Local timezone' },
    localTimestamp: { type: 'string', description: 'Local timestamp' },
    membersRemoved: { type: 'array', description: 'Members removed (nullable)' },
    reactionsAdded: { type: 'array', description: 'Reactions added (nullable)' },
    semanticAction: { type: 'string', description: 'Semantic action (nullable)' },
    textHighlights: { type: 'string', description: 'Text highlights (nullable)' },
    attachmentLayout: { type: 'string', description: 'Attachment layout (nullable)' },
    historyDisclosed: { type: 'boolean', description: 'History disclosed (nullable)' },
    reactionsRemoved: { type: 'array', description: 'Reactions removed (nullable)' },
    suggestedActions: { type: 'string', description: 'Suggested actions (nullable)' },
  },

  instructions: [
    'Open Microsoft Teams and go to the team where you want to add the webhook.',
    'Click the three dots (•••) next to the team name and select "Manage team".',
    'Go to the "Apps" tab and click "Create an outgoing webhook".',
    'Provide a name, description, and optionally a profile picture.',
    'Set the callback URL to your Sim webhook URL (shown above).',
    'Copy the HMAC security token and paste it into the "HMAC Secret" field above.',
    'Click "Create" to finish setup.',
  ],

  samplePayload: {
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

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
