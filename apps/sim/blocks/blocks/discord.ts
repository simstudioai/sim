import { DiscordIcon } from '@/components/icons'
import type { DiscordResponse } from '@/tools/discord/types'
import type { BlockConfig } from '../types'

export const DiscordBlock: BlockConfig<DiscordResponse> = {
  type: 'discord',
  name: 'Discord',
  description: 'Interact with Discord',
  longDescription:
    'Connect to Discord to send messages, manage channels, and interact with servers. Automate notifications, community management, and integrate Discord into your workflows.',
  category: 'tools',
  bgColor: '#E0E0E0',
  icon: DiscordIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      layout: 'full',
      options: [
        { label: 'Send Message', id: 'discord_send_message' },
        { label: 'Get Channel Messages', id: 'discord_get_messages' },
        { label: 'Get Server Information', id: 'discord_get_server' },
        { label: 'Get User Information', id: 'discord_get_user' },
      ],
    },
    {
      id: 'botToken',
      title: 'Bot Token',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter Discord bot token',
      password: true,
    },
    {
      id: 'serverId',
      title: 'Server',
      type: 'project-selector',
      layout: 'full',
      provider: 'discord',
      serviceId: 'discord',
      placeholder: 'Select Discord server',
      condition: {
        field: 'operation',
        value: ['discord_send_message', 'discord_get_messages', 'discord_get_server'],
      },
    },
    {
      id: 'channelId',
      title: 'Channel',
      type: 'file-selector',
      layout: 'full',
      provider: 'discord',
      serviceId: 'discord',
      placeholder: 'Select Discord channel',
      condition: { field: 'operation', value: ['discord_send_message', 'discord_get_messages'] },
    },
    {
      id: 'userId',
      title: 'User ID',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter Discord user ID',
      condition: { field: 'operation', value: 'discord_get_user' },
    },
    {
      id: 'limit',
      title: 'Message Limit',
      type: 'short-input',
      layout: 'half',
      placeholder: 'Number of messages (default: 10, max: 100)',
      condition: { field: 'operation', value: 'discord_get_messages' },
    },
    {
      id: 'content',
      title: 'Message Content',
      type: 'long-input',
      layout: 'full',
      placeholder: 'Enter message content...',
      condition: { field: 'operation', value: 'discord_send_message' },
    },
  ],
  tools: {
    access: [
      'discord_send_message',
      'discord_get_messages',
      'discord_get_server',
      'discord_get_user',
    ],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'discord_send_message':
            return 'discord_send_message'
          case 'discord_get_messages':
            return 'discord_get_messages'
          case 'discord_get_server':
            return 'discord_get_server'
          case 'discord_get_user':
            return 'discord_get_user'
          default:
            return 'discord_send_message'
        }
      },
      params: (params) => {
        const commonParams: Record<string, any> = {}

        if (!params.botToken) throw new Error('Bot token required for this operation')
        commonParams.botToken = params.botToken

        switch (params.operation) {
          case 'discord_send_message':
            return {
              ...commonParams,
              serverId: params.serverId,
              channelId: params.channelId,
              content: params.content,
            }
          case 'discord_get_messages':
            return {
              ...commonParams,
              serverId: params.serverId,
              channelId: params.channelId,
              limit: params.limit ? Math.min(Math.max(1, Number(params.limit)), 100) : 10,
            }
          case 'discord_get_server':
            return {
              ...commonParams,
              serverId: params.serverId,
            }
          case 'discord_get_user':
            return {
              ...commonParams,
              userId: params.userId,
            }
          default:
            return commonParams
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', required: true },
    botToken: { type: 'string', required: true },
    serverId: { type: 'string', required: false },
    channelId: { type: 'string', required: false },
    content: { type: 'string', required: false },
    limit: { type: 'number', required: false },
    userId: { type: 'string', required: false },
  },
  outputs: {
    message: 'string',
    data: 'any',
  },
}
