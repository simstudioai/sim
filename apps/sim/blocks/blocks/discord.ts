import { DiscordIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import type { DiscordResponse } from '@/tools/discord/types'

export const DiscordBlock: BlockConfig<DiscordResponse> = {
  type: 'discord',
  name: 'Discord',
  description: 'Interact with Discord',
  longDescription:
    'Integrate Discord into the workflow. Can send and get messages, get server information, and get a user’s information. Requires bot API key.',
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
      value: () => 'discord_send_message',
    },
    {
      id: 'botToken',
      title: 'Bot Token',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter Discord bot token',
      password: true,
      required: true,
    },
    {
      id: 'serverId',
      title: 'Server ID',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter Discord server ID',
      required: true,
      provider: 'discord',
      serviceId: 'discord',
      condition: {
        field: 'operation',
        value: ['discord_send_message', 'discord_get_messages', 'discord_get_server'],
      },
    },
    // Channel ID (single input used in all modes)
    {
      id: 'channelId',
      title: 'Channel ID',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter Discord channel ID',
      required: true,
      provider: 'discord',
      serviceId: 'discord',
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

        // Single inputs
        const serverId = (params.serverId || '').trim()
        const channelId = (params.channelId || '').trim()

        switch (params.operation) {
          case 'discord_send_message':
            if (!serverId) {
              throw new Error('Server ID is required.')
            }
            if (!channelId) {
              throw new Error('Channel ID is required.')
            }
            return {
              ...commonParams,
              serverId,
              channelId,
              content: params.content,
            }
          case 'discord_get_messages':
            if (!serverId) {
              throw new Error('Server ID is required.')
            }
            if (!channelId) {
              throw new Error('Channel ID is required.')
            }
            return {
              ...commonParams,
              serverId,
              channelId,
              limit: params.limit ? Math.min(Math.max(1, Number(params.limit)), 100) : 10,
            }
          case 'discord_get_server':
            if (!serverId) {
              throw new Error('Server ID is required.')
            }
            return {
              ...commonParams,
              serverId,
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
    operation: { type: 'string', description: 'Operation to perform' },
    botToken: { type: 'string', description: 'Discord bot token' },
    serverId: { type: 'string', description: 'Discord server identifier' },
    channelId: { type: 'string', description: 'Discord channel identifier' },
    content: { type: 'string', description: 'Message content' },
    limit: { type: 'number', description: 'Message limit' },
    userId: { type: 'string', description: 'Discord user identifier' },
  },
  outputs: {
    message: { type: 'string', description: 'Message content' },
    data: { type: 'json', description: 'Response data' },
  },
}
