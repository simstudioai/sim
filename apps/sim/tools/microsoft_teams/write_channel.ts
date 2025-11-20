import type {
  MicrosoftTeamsToolParams,
  MicrosoftTeamsWriteResponse,
} from '@/tools/microsoft_teams/types'
import type { ToolConfig } from '@/tools/types'

export const writeChannelTool: ToolConfig<MicrosoftTeamsToolParams, MicrosoftTeamsWriteResponse> = {
  id: 'microsoft_teams_write_channel',
  name: 'Write to Microsoft Teams Channel',
  description: 'Write or send a message to a Microsoft Teams channel',
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
      visibility: 'user-only',
      description: 'The ID of the team to write to',
    },
    channelId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'The ID of the channel to write to',
    },
    content: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The content to write to the channel',
    },
    files: {
      type: 'file[]',
      required: false,
      visibility: 'user-only',
      description: 'Files to attach to the message',
    },
  },

  outputs: {
    success: { type: 'boolean', description: 'Teams channel message send success status' },
    messageId: { type: 'string', description: 'Unique identifier for the sent message' },
    teamId: { type: 'string', description: 'ID of the team where message was sent' },
    channelId: { type: 'string', description: 'ID of the channel where message was sent' },
    createdTime: { type: 'string', description: 'Timestamp when message was created' },
    url: { type: 'string', description: 'Web URL to the message' },
    updatedContent: { type: 'boolean', description: 'Whether content was successfully updated' },
  },

  request: {
    url: (params) => {
      const teamId = params.teamId?.trim()
      if (!teamId) {
        throw new Error('Team ID is required')
      }

      const channelId = params.channelId?.trim()
      if (!channelId) {
        throw new Error('Channel ID is required')
      }

      // If files are provided, use custom API route for attachment handling
      if (params.files && params.files.length > 0) {
        return '/api/tools/microsoft_teams/write_channel'
      }

      // If content contains mentions, use custom API route for mention resolution
      const hasMentions = /<at>[^<]+<\/at>/i.test(params.content || '')
      if (hasMentions) {
        return '/api/tools/microsoft_teams/write_channel'
      }

      const encodedTeamId = encodeURIComponent(teamId)
      const encodedChannelId = encodeURIComponent(channelId)

      const url = `https://graph.microsoft.com/v1.0/teams/${encodedTeamId}/channels/${encodedChannelId}/messages`

      return url
    },
    method: 'POST',
    headers: (params) => {
      // Validate access token
      if (!params.accessToken) {
        throw new Error('Access token is required')
      }

      return {
        Authorization: `Bearer ${params.accessToken}`,
        'Content-Type': 'application/json',
      }
    },
    body: (params) => {
      // Validate content
      if (!params.content) {
        throw new Error('Content is required')
      }

      // If using custom API route (with files or mentions), pass all params
      const hasMentions = /<at>[^<]+<\/at>/i.test(params.content || '')
      if (params.files && params.files.length > 0) {
        return {
          accessToken: params.accessToken,
          teamId: params.teamId,
          channelId: params.channelId,
          content: params.content,
          files: params.files,
        }
      }

      if (hasMentions) {
        return {
          accessToken: params.accessToken,
          teamId: params.teamId,
          channelId: params.channelId,
          content: params.content,
        }
      }

      // Microsoft Teams API expects this specific format for channel messages
      const requestBody = {
        body: {
          contentType: 'text',
          content: params.content,
        },
      }

      return requestBody
    },
  },
  transformResponse: async (response: Response, params?: MicrosoftTeamsToolParams) => {
    const data = await response.json()

    // Handle custom API route response format
    if (data.success !== undefined && data.output) {
      return data
    }

    // Handle direct Graph API response format
    const metadata = {
      messageId: data.id || '',
      teamId: data.channelIdentity?.teamId || '',
      channelId: data.channelIdentity?.channelId || '',
      content: data.body?.content || params?.content || '',
      createdTime: data.createdDateTime || new Date().toISOString(),
      url: data.webUrl || '',
    }

    return {
      success: true,
      output: {
        updatedContent: true,
        metadata,
      },
    }
  },
}
