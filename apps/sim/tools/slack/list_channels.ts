import type { SlackListChannelsParams, SlackListChannelsResponse } from '@/tools/slack/types'
import { CHANNEL_OUTPUT_PROPERTIES } from '@/tools/slack/types'
import type { ToolConfig } from '@/tools/types'

export const slackListChannelsTool: ToolConfig<SlackListChannelsParams, SlackListChannelsResponse> =
  {
    id: 'slack_list_channels',
    name: 'Slack List Channels',
    description:
      'List all channels in a Slack workspace. Returns public and private channels the bot has access to.',
    version: '1.0.0',

    oauth: {
      required: true,
      provider: 'slack',
    },

    params: {
      authMethod: {
        type: 'string',
        required: false,
        visibility: 'user-only',
        description: 'Authentication method: oauth or bot_token',
      },
      botToken: {
        type: 'string',
        required: false,
        visibility: 'user-only',
        description: 'Bot token for Custom Bot',
      },
      accessToken: {
        type: 'string',
        required: false,
        visibility: 'hidden',
        description: 'OAuth access token or bot token for Slack API',
      },
      includePrivate: {
        type: 'boolean',
        required: false,
        visibility: 'user-or-llm',
        description: 'Include private channels the bot is a member of (default: true)',
      },
      excludeArchived: {
        type: 'boolean',
        required: false,
        visibility: 'user-or-llm',
        description: 'Exclude archived channels (default: true)',
      },
      limit: {
        type: 'number',
        required: false,
        visibility: 'user-or-llm',
        description: 'Maximum number of channels to return (default: 100, max: 200)',
      },
    },

    request: {
      url: (params: SlackListChannelsParams) => {
        const url = new URL('https://slack.com/api/conversations.list')

        // Determine channel types to include
        const includePrivate = params.includePrivate !== false
        if (includePrivate) {
          url.searchParams.append('types', 'public_channel,private_channel')
        } else {
          url.searchParams.append('types', 'public_channel')
        }

        // Exclude archived by default
        const excludeArchived = params.excludeArchived !== false
        url.searchParams.append('exclude_archived', String(excludeArchived))

        // Set limit (default 100, max 200)
        const limit = params.limit ? Math.min(Number(params.limit), 200) : 100
        url.searchParams.append('limit', String(limit))

        return url.toString()
      },
      method: 'GET',
      headers: (params: SlackListChannelsParams) => ({
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.accessToken || params.botToken}`,
      }),
    },

    transformResponse: async (response: Response) => {
      const data = await response.json()

      if (!data.ok) {
        if (data.error === 'missing_scope') {
          throw new Error(
            'Missing required permissions. Please reconnect your Slack account with the necessary scopes (channels:read, groups:read).'
          )
        }
        if (data.error === 'invalid_auth') {
          throw new Error('Invalid authentication. Please check your Slack credentials.')
        }
        throw new Error(data.error || 'Failed to list channels from Slack')
      }

      const channels = (data.channels || []).map((channel: any) => ({
        id: channel.id,
        name: channel.name,
        is_private: channel.is_private || false,
        is_archived: channel.is_archived || false,
        is_member: channel.is_member || false,
        num_members: channel.num_members,
        topic: channel.topic?.value || '',
        purpose: channel.purpose?.value || '',
        created: channel.created,
        creator: channel.creator,
      }))

      const ids = channels.map((channel: { id: string }) => channel.id)
      const names = channels.map((channel: { name: string }) => channel.name)

      return {
        success: true,
        output: {
          channels,
          ids,
          names,
          count: channels.length,
        },
      }
    },

    outputs: {
      channels: {
        type: 'array',
        description: 'Array of channel objects from the workspace',
        items: {
          type: 'object',
          properties: CHANNEL_OUTPUT_PROPERTIES,
        },
      },
      ids: {
        type: 'array',
        description: 'Array of channel IDs for easy access',
        items: { type: 'string', description: 'Channel ID' },
      },
      names: {
        type: 'array',
        description: 'Array of channel names for easy access',
        items: { type: 'string', description: 'Channel name' },
      },
      count: {
        type: 'number',
        description: 'Total number of channels returned',
      },
    },
  }
