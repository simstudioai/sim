import { DiscordIcon } from '@/components/icons'
import type { TriggerConfig } from '../types'

export const discordWebhookTrigger: TriggerConfig = {
  id: 'discord_webhook',
  name: 'Discord Webhook',
  provider: 'discord',
  description: 'Trigger workflow from Discord webhook events and send messages to Discord channels',
  version: '1.0.0',
  icon: DiscordIcon,

  configFields: {
    webhookName: {
      type: 'string',
      label: 'Webhook Name',
      placeholder: 'Sim Bot',
      description: 'This name will be displayed as the sender of messages in Discord.',
      required: false,
    },
    avatarUrl: {
      type: 'string',
      label: 'Avatar URL',
      placeholder: 'https://example.com/avatar.png',
      description: "URL to an image that will be used as the webhook's avatar.",
      required: false,
    },
  },

  outputs: {
    content: {
      type: 'string',
      description: 'Message content from Discord webhook',
    },
    username: {
      type: 'string',
      description: 'Username of the sender (if provided)',
    },
    avatar_url: {
      type: 'string',
      description: 'Avatar URL of the sender (if provided)',
    },
    timestamp: {
      type: 'string',
      description: 'Timestamp when the webhook was triggered',
    },
    webhook_id: {
      type: 'string',
      description: 'Discord webhook identifier',
    },
    webhook_token: {
      type: 'string',
      description: 'Discord webhook token',
    },
    guild_id: {
      type: 'string',
      description: 'Discord server/guild ID',
    },
    channel_id: {
      type: 'string',
      description: 'Discord channel ID where the event occurred',
    },
    embeds: {
      type: 'string',
      description: 'Embedded content data (if any)',
    },
  },

  instructions: [
    'Go to Discord Server Settings > Integrations.',
    'Click "Webhooks" then "New Webhook".',
    'Customize the name and channel.',
    'Click "Copy Webhook URL".',
    'Paste the copied Discord URL into the main <strong>Webhook URL</strong> field above.',
    'Your workflow triggers when Discord sends an event to that URL.',
  ],

  samplePayload: {
    content: 'Hello from Sim!',
    username: 'Optional Custom Name',
    avatar_url: 'https://example.com/avatar.png',
    timestamp: new Date().toISOString(),
    webhook_id: '1234567890123456789',
    webhook_token: 'example-webhook-token',
    guild_id: '0987654321098765432',
    channel_id: '1122334455667788990',
    embeds: [],
  },

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
