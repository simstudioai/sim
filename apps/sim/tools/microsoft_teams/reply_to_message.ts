import type {
  MicrosoftTeamsReplyParams,
  MicrosoftTeamsWriteResponse,
} from '@/tools/microsoft_teams/types'
import { buildMessageBody } from '@/tools/microsoft_teams/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

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
      visibility: 'user-or-llm',
      description:
        'The ID of the team (e.g., "12345678-abcd-1234-efgh-123456789012" - a GUID from team listings or channel info)',
    },
    channelId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'The ID of the channel (e.g., "19:abc123def456@thread.tacv2" - from channel listings)',
    },
    messageId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'The ID of the message to reply to (e.g., "1234567890123" - a numeric string from message responses)',
    },
    content: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The reply content (plain text, or HTML when contentType is "html")',
    },
    contentType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Body format: "text" (default) or "html"',
    },
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the reply was successful' },
    messageId: { type: 'string', description: 'ID of the reply message' },
    updatedContent: { type: 'boolean', description: 'Whether content was successfully sent' },
    createdTime: {
      type: 'string',
      description: 'Timestamp when the reply was created',
      optional: true,
    },
    url: { type: 'string', description: 'Web URL to the reply', optional: true },
    replyToId: { type: 'string', description: 'ID of the parent message', optional: true },
  },

  request: {
    url: (params) => {
      if (!params.teamId?.trim() || !params.channelId?.trim() || !params.messageId?.trim()) {
        throw new Error('Team ID, Channel ID, and Message ID are required')
      }
      const teamId = safeUrlPathSegment(params.teamId, 'Team ID')
      const channelId = safeUrlPathSegment(params.channelId, 'Channel ID')
      const messageId = safeUrlPathSegment(params.messageId, 'Message ID')
      return `https://graph.microsoft.com/v1.0/teams/${teamId}/channels/${channelId}/messages/${messageId}/replies`
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
      return { body: buildMessageBody(params.content, params.contentType) }
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
        messageId: metadata.messageId,
        createdTime: metadata.createdTime,
        url: metadata.url,
        replyToId: data.replyToId ?? null,
      },
    }
  },
}
