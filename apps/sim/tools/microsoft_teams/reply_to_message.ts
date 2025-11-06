import type {
  MicrosoftTeamsReplyParams,
  MicrosoftTeamsWriteResponse,
} from '@/tools/microsoft_teams/types'
import type { ToolConfig } from '@/tools/types'

export const replyToMessageTool: ToolConfig<
  MicrosoftTeamsReplyParams,
  MicrosoftTeamsWriteResponse
> = {
  id: 'microsoft_teams_reply_to_message',
  name: 'Reply to Microsoft Teams Channel Message',
  description: 'Reply to an existing message in a Microsoft Teams channel',
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
      description: 'The ID of the team',
    },
    channelId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'The ID of the channel',
    },
    messageId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the message to reply to',
    },
    content: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The reply content',
    },
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the reply was successful' },
    messageId: { type: 'string', description: 'ID of the reply message' },
    updatedContent: { type: 'boolean', description: 'Whether content was successfully sent' },
  },

  request: {
    url: (params) => {
      const teamId = params.teamId?.trim()
      const channelId = params.channelId?.trim()
      const messageId = params.messageId?.trim()
      if (!teamId || !channelId || !messageId) {
        throw new Error('Team ID, Channel ID, and Message ID are required')
      }
      return `https://graph.microsoft.com/v1.0/teams/${encodeURIComponent(teamId)}/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}/replies`
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
    body: (params) => {
      if (!params.content) {
        throw new Error('Content is required')
      }
      return {
        body: {
          contentType: 'text',
          content: params.content,
        },
      }
    },
  },

  transformResponse: async (response: Response, params?: MicrosoftTeamsReplyParams) => {
    const data = await response.json()

    const metadata = {
      messageId: data.id || '',
      teamId: params?.teamId || '',
      channelId: params?.channelId || '',
      content: data.body?.content || params?.content || '',
      createdTime: data.createdDateTime || '',
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
