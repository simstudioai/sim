import { DiscordIcon } from '@/components/icons'
import type { ConnectorMeta } from '@/connectors/types'

export const DEFAULT_MAX_MESSAGES = 1000

export const discordConnectorMeta: ConnectorMeta = {
  id: 'discord',
  name: 'Discord',
  description: 'Sync channel messages from Discord',
  version: '1.0.0',
  icon: DiscordIcon,

  auth: {
    mode: 'apiKey',
    label: 'Bot Token',
    placeholder: 'Enter your Discord bot token',
  },

  configFields: [
    {
      id: 'channelId',
      title: 'Channel ID',
      type: 'short-input',
      placeholder: 'e.g. 123456789012345678',
      required: true,
      description: 'The Discord channel ID to sync messages from',
    },
    {
      id: 'maxMessages',
      title: 'Max Messages',
      type: 'short-input',
      required: false,
      placeholder: `e.g. 500 (default: ${DEFAULT_MAX_MESSAGES})`,
    },
  ],

  tagDefinitions: [
    { id: 'channelName', displayName: 'Channel Name', fieldType: 'text' },
    { id: 'messageCount', displayName: 'Message Count', fieldType: 'number' },
    { id: 'lastActivity', displayName: 'Last Activity', fieldType: 'date' },
  ],
}
