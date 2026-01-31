import type {
  MicrosoftTeamsDeleteMessageParams,
  MicrosoftTeamsDeleteResponse,
} from '@/tools/microsoft_teams/types'
import type { ToolConfig } from '@/tools/types'

export const deleteChannelMessageTool: ToolConfig<
  MicrosoftTeamsDeleteMessageParams,
  MicrosoftTeamsDeleteResponse
> = {
  id: 'microsoft_teams_delete_channel_message',
  name: 'Delete Microsoft Teams Channel Message',
  description: 'Soft delete a message in a Microsoft Teams channel',
  version: '1.0',
  errorExtractor: 'nested-error-object',
  oauth: {
    required: true,
    provider: 'microsoft-teams',
  },
  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'The access token for the Microsoft Teams API',
    },
    teamId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'The ID of the team (e.g., "12345678-abcd-1234-efgh-123456789012" - a GUID from team listings or channel info)',
    },
    channelId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'The ID of the channel containing the message (e.g., "19:abc123def456@thread.tacv2" - from channel listings)',
    },
    messageId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'The ID of the message to delete (e.g., "1234567890123" - a numeric string from message responses)',
    },
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the deletion was successful' },
    deleted: { type: 'boolean', description: 'Confirmation of deletion' },
    messageId: { type: 'string', description: 'ID of the deleted message' },
  },

  request: {
    url: (params) => {
      const teamId = params.teamId?.trim()
      const channelId = params.channelId?.trim()
      const messageId = params.messageId?.trim()
      if (!teamId || !channelId || !messageId) {
        throw new Error('Team ID, Channel ID, and Message ID are required')
      }
      return `https://graph.microsoft.com/v1.0/teams/${encodeURIComponent(teamId)}/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}/softDelete`
    },
    method: 'POST',
    headers: (params) => {
      if (!params.accessToken) {
        throw new Error('Access token is required')
      }
      return {
        Authorization: `Bearer ${params.accessToken}`,
        'Content-Type': 'application/json',
      }
    },
  },

  transformResponse: async (_response: Response, params?: MicrosoftTeamsDeleteMessageParams) => {
    // Soft delete returns 204 No Content on success
    return {
      success: true,
      output: {
        deleted: true,
        messageId: params?.messageId || '',
        metadata: {
          messageId: params?.messageId || '',
          teamId: params?.teamId || '',
          channelId: params?.channelId || '',
        },
      },
    }
  },
}
