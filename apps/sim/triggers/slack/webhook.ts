import { SlackIcon } from '@/components/icons'
import type { TriggerConfig } from '@/triggers/types'

export const slackWebhookTrigger: TriggerConfig = {
  id: 'slack_webhook',
  name: 'Slack Webhook',
  provider: 'slack',
  description: 'Trigger workflow from Slack events like mentions, messages, and reactions',
  version: '1.0.0',
  icon: SlackIcon,

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
      id: 'signingSecret',
      title: 'Signing Secret',
      type: 'short-input',
      placeholder: 'Enter your Slack app signing secret',
      description: 'The signing secret from your Slack app to validate request authenticity.',
      password: true,
      required: true,
      mode: 'trigger',
    },
    {
      id: 'botToken',
      title: 'Bot Token',
      type: 'short-input',
      placeholder: 'xoxb-...',
      description:
        'The bot token from your Slack app. Required for downloading files attached to messages.',
      password: true,
      required: false,
      mode: 'trigger',
    },
    {
      id: 'includeFiles',
      title: 'Include File Attachments',
      type: 'switch',
      defaultValue: false,
      description:
        'Download and include file attachments from messages. Requires a bot token with files:read scope.',
      required: false,
      mode: 'trigger',
    },
    {
      id: 'triggerSave',
      title: '',
      type: 'trigger-save',
      hideFromPreview: true,
      mode: 'trigger',
      triggerId: 'slack_webhook',
    },
    {
      id: 'triggerInstructions',
      title: 'Setup Instructions',
      type: 'text',
      defaultValue: [
        'Go to <a href="https://api.slack.com/apps" target="_blank" rel="noopener noreferrer" class="text-muted-foreground underline transition-colors hover:text-muted-foreground/80">Slack Apps page</a>',
        'If you don\'t have an app:<br><ul class="mt-1 ml-5 list-disc"><li>Create an app from scratch</li><li>Give it a name and select your workspace</li></ul>',
        'Go to "Basic Information", find the "Signing Secret", and paste it in the field above.',
        'Go to "OAuth & Permissions" and add bot token scopes:<br><ul class="mt-1 ml-5 list-disc"><li><code>app_mentions:read</code> - For viewing messages that tag your bot with an @</li><li><code>chat:write</code> - To send messages to channels your bot is a part of</li><li><code>files:read</code> - To access files and images shared in messages</li></ul>',
        'Go to "Event Subscriptions":<br><ul class="mt-1 ml-5 list-disc"><li>Enable events</li><li>Under "Subscribe to Bot Events", add <code>app_mention</code> to listen to messages that mention your bot</li><li>Paste the Webhook URL above into the "Request URL" field</li></ul>',
        'Go to "Install App" in the left sidebar and install the app into your desired Slack workspace and channel.',
        'Copy the "Bot User OAuth Token" (starts with <code>xoxb-</code>) and paste it in the Bot Token field above to enable file downloads.',
        'Save changes in both Slack and here.',
      ]
        .map(
          (instruction, index) =>
            `<div class="mb-3"><strong>${index + 1}.</strong> ${instruction}</div>`
        )
        .join(''),
      hideFromPreview: true,
      mode: 'trigger',
    },
  ],

  outputs: {
    event: {
      type: 'object',
      description: 'Slack event data',
      properties: {
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
          description: 'Message timestamp from the triggering event',
        },
        thread_ts: {
          type: 'string',
          description: 'Parent thread timestamp (if message is in a thread)',
        },
        team_id: {
          type: 'string',
          description: 'Slack workspace/team ID',
        },
        event_id: {
          type: 'string',
          description: 'Unique event identifier',
        },
        hasFiles: {
          type: 'boolean',
          description: 'Whether the message has file attachments',
        },
        files: {
          type: 'file[]',
          description:
            'File attachments downloaded from the message (if includeFiles is enabled and bot token is provided)',
        },
      },
    },
  },

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
