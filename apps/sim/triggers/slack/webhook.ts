import { SlackIcon } from '@/components/icons'
import type { TriggerConfig } from '../types'

export const slackWebhookTrigger: TriggerConfig = {
  id: 'slack_webhook',
  name: 'Slack Webhook',
  provider: 'slack',
  description: 'Trigger workflow from Slack events like mentions, messages, and reactions',
  version: '1.0.0',
  icon: SlackIcon,

  configFields: {
    signingSecret: {
      type: 'string',
      label: 'Signing Secret',
      placeholder: 'Enter your Slack app signing secret',
      description: 'The signing secret from your Slack app to validate request authenticity.',
      required: true,
      isSecret: true,
    },
  },

  outputs: {
    event_type: {
      type: 'string',
      description: 'Type of Slack event (e.g., app_mention, message)',
    },
    channel: {
      type: 'string',
      description: 'Slack channel ID where the event occurred',
    },
    channel_name: {
      type: 'string',
      description: 'Human-readable channel name',
    },
    user: {
      type: 'string',
      description: 'User ID who triggered the event',
    },
    user_name: {
      type: 'string',
      description: 'Username who triggered the event',
    },
    text: {
      type: 'string',
      description: 'Message text content',
    },
    timestamp: {
      type: 'string',
      description: 'Event timestamp',
    },
    team_id: {
      type: 'string',
      description: 'Slack workspace/team ID',
    },
    event_id: {
      type: 'string',
      description: 'Unique event identifier',
    },
  },

  instructions: [
    'Go to <a href="https://api.slack.com/apps" target="_blank" rel="noopener noreferrer" class="text-primary underline transition-colors hover:text-primary/80">Slack Apps page</a>',
    'If you don\'t have an app:<br><ul class="mt-1 ml-5 list-disc"><li>Create an app from scratch</li><li>Give it a name and select your workspace</li></ul>',
    'Go to "Basic Information", find the "Signing Secret", and paste it in the field above.',
    'Go to "OAuth & Permissions" and add bot token scopes:<br><ul class="mt-1 ml-5 list-disc"><li><code>app_mentions:read</code> - For viewing messages that tag your bot with an @</li><li><code>chat:write</code> - To send messages to channels your bot is a part of</li></ul>',
    'Go to "Event Subscriptions":<br><ul class="mt-1 ml-5 list-disc"><li>Enable events</li><li>Under "Subscribe to Bot Events", add <code>app_mention</code> to listen to messages that mention your bot</li><li>Paste the Webhook URL (from above) into the "Request URL" field</li></ul>',
    'Save changes in both Slack and here.',
  ],

  samplePayload: {
    type: 'event_callback',
    event: {
      type: 'app_mention',
      channel: 'C0123456789',
      user: 'U0123456789',
      text: '<@U0BOTUSER123> Hello from Slack!',
      ts: '1234567890.123456',
      channel_type: 'channel',
    },
    team_id: 'T0123456789',
    event_id: 'Ev0123456789',
    event_time: 1234567890,
  },

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
