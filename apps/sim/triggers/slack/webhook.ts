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
      id: 'setupWizard',
      title: 'Slack app setup',
      type: 'modal',
      modalId: 'slack-setup-wizard',
      description: 'Walk through manifest creation, app install, and pasting credentials.',
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
        subtype: {
          type: 'string',
          description:
            'Message subtype (e.g., channel_join, channel_leave, bot_message, file_share). Null for regular user messages',
        },
        channel: {
          type: 'string',
          description: 'Slack channel ID where the event occurred',
        },
        channel_name: {
          type: 'string',
          description: 'Human-readable channel name',
        },
        channel_type: {
          type: 'string',
          description:
            'Type of channel (e.g., channel, group, im, mpim). Useful for distinguishing DMs from public channels',
        },
        user: {
          type: 'string',
          description: 'User ID who triggered the event',
        },
        user_name: {
          type: 'string',
          description: 'Username who triggered the event',
        },
        bot_id: {
          type: 'string',
          description: 'Bot ID if the message was sent by a bot. Null for human users',
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
        reaction: {
          type: 'string',
          description:
            'Emoji reaction name (e.g., thumbsup). Present for reaction_added/reaction_removed events',
        },
        item_user: {
          type: 'string',
          description:
            'User ID of the original message author. Present for reaction_added/reaction_removed events',
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
