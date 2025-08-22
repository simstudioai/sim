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
    type: {
      type: 'string',
      description: 'Type of Teams message (e.g., message)',
    },
    id: {
      type: 'string',
      description: 'Unique message identifier',
    },
    input: {
      type: 'string',
      description: 'Input message',
    },
    timestamp: {
      type: 'string',
      description: 'Message timestamp',
    },
    localTimestamp: {
      type: 'string',
      description: 'Local timestamp of the message',
    },
    serviceUrl: {
      type: 'string',
      description: 'Microsoft Teams service URL',
    },
    channelId: {
      type: 'string',
      description: 'Teams channel ID where the event occurred',
    },
    from_id: {
      type: 'string',
      description: 'User ID who sent the message',
    },
    from_name: {
      type: 'string',
      description: 'Username who sent the message',
    },
    conversation_id: {
      type: 'string',
      description: 'Conversation/thread ID',
    },
    text: {
      type: 'string',
      description: 'Message text content',
    },
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
