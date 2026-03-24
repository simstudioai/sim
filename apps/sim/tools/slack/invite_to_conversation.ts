import type {
  SlackInviteToConversationParams,
  SlackInviteToConversationResponse,
} from '@/tools/slack/types'
import { CHANNEL_OUTPUT_PROPERTIES } from '@/tools/slack/types'
import type { ToolConfig } from '@/tools/types'

export const slackInviteToConversationTool: ToolConfig<
  SlackInviteToConversationParams,
  SlackInviteToConversationResponse
> = {
  id: 'slack_invite_to_conversation',
  name: 'Slack Invite to Conversation',
  description: 'Invite one or more users to a Slack channel. Supports up to 100 users at a time.',
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
    channel: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the channel to invite users to',
    },
    users: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Comma-separated list of user IDs to invite (up to 100)',
    },
    force: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'When true, continues inviting valid users while skipping invalid ones (default: false)',
    },
  },

  request: {
    url: 'https://slack.com/api/conversations.invite',
    method: 'POST',
    headers: (params: SlackInviteToConversationParams) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.accessToken || params.botToken}`,
    }),
    body: (params: SlackInviteToConversationParams) => {
      const body: Record<string, unknown> = {
        channel: params.channel?.trim(),
        users: params.users?.trim(),
      }
      if (params.force != null) {
        body.force = params.force
      }
      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.ok) {
      if (data.error === 'channel_not_found') {
        throw new Error('Channel not found. Please verify the channel ID.')
      }
      if (data.error === 'user_not_found') {
        throw new Error('One or more user IDs were not found.')
      }
      if (data.error === 'cant_invite_self') {
        throw new Error('You cannot invite yourself to a channel.')
      }
      if (data.error === 'already_in_channel') {
        throw new Error('One or more users are already in the channel.')
      }
      if (data.error === 'is_archived') {
        throw new Error('The channel is archived and cannot accept new members.')
      }
      if (data.error === 'not_in_channel') {
        throw new Error('The authenticated user is not a member of this channel.')
      }
      if (data.error === 'cant_invite') {
        throw new Error('This user cannot be invited to the channel.')
      }
      if (data.error === 'no_permission') {
        throw new Error('You do not have permission to invite this user to the channel.')
      }
      if (data.error === 'org_user_not_in_team') {
        throw new Error(
          'One or more invited members are in the Enterprise org but not this workspace.'
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
      throw new Error(data.error || 'Failed to invite users to Slack conversation')
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
        ...(data.errors?.length ? { errors: data.errors } : {}),
      },
    }
  },

  outputs: {
    channelInfo: {
      type: 'object',
      description: 'The channel object after inviting users',
      properties: CHANNEL_OUTPUT_PROPERTIES,
    },
    errors: {
      type: 'array',
      description: 'Per-user errors when force is true and some invitations failed',
      optional: true,
      items: {
        type: 'object',
        properties: {
          user: { type: 'string', description: 'User ID that failed' },
          ok: { type: 'boolean', description: 'Always false for error entries' },
          error: { type: 'string', description: 'Error code for this user' },
        },
      },
    },
  },
}
