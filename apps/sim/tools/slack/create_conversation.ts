import type {
  SlackCreateConversationParams,
  SlackCreateConversationResponse,
} from '@/tools/slack/types'
import { CHANNEL_OUTPUT_PROPERTIES } from '@/tools/slack/types'
import type { ToolConfig } from '@/tools/types'

export const slackCreateConversationTool: ToolConfig<
  SlackCreateConversationParams,
  SlackCreateConversationResponse
> = {
  id: 'slack_create_conversation',
  name: 'Slack Create Conversation',
  description: 'Create a new public or private channel in a Slack workspace.',
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
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Name of the channel to create (lowercase, numbers, hyphens, underscores only; max 80 characters)',
    },
    isPrivate: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Create a private channel instead of a public one (default: false)',
    },
    teamId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Encoded team ID to create the channel in (required if using an org token)',
    },
  },

  request: {
    url: 'https://slack.com/api/conversations.create',
    method: 'POST',
    headers: (params: SlackCreateConversationParams) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.accessToken || params.botToken}`,
    }),
    body: (params: SlackCreateConversationParams) => {
      const body: Record<string, unknown> = {
        name: params.name?.trim(),
      }
      if (params.isPrivate != null) {
        body.is_private = params.isPrivate
      }
      if (params.teamId?.trim()) {
        body.team_id = params.teamId.trim()
      }
      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.ok) {
      if (data.error === 'name_taken') {
        throw new Error('A channel with this name already exists in the workspace.')
      }
      if (
        data.error === 'invalid_name' ||
        data.error === 'invalid_name_specials' ||
        data.error === 'invalid_name_maxlength'
      ) {
        throw new Error(
          'Invalid channel name. Use only lowercase letters, numbers, hyphens, and underscores (max 80 characters).'
        )
      }
      if (data.error === 'missing_scope') {
        throw new Error(
          'Missing required permissions. Please reconnect your Slack account with the necessary scopes (channels:manage, groups:write).'
        )
      }
      if (data.error === 'invalid_auth') {
        throw new Error('Invalid authentication. Please check your Slack credentials.')
      }
      if (data.error === 'restricted_action') {
        throw new Error('Workspace policy prevents channel creation.')
      }
      throw new Error(data.error || 'Failed to create conversation in Slack')
    }

    const ch = data.channel || {}

    return {
      success: true,
      output: {
        channelInfo: {
          id: ch.id,
          name: ch.name,
          is_private: ch.is_private || false,
          is_archived: ch.is_archived || false,
          is_member: ch.is_member || false,
          topic: ch.topic?.value || '',
          purpose: ch.purpose?.value || '',
          created: ch.created,
          creator: ch.creator,
        },
      },
    }
  },

  outputs: {
    channelInfo: {
      type: 'object',
      description: 'The newly created channel object',
      properties: CHANNEL_OUTPUT_PROPERTIES,
    },
  },
}
