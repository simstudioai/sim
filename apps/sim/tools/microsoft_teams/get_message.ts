import type {
  MicrosoftTeamsGetMessageParams,
  MicrosoftTeamsReadResponse,
} from '@/tools/microsoft_teams/types'
import type { ToolConfig } from '@/tools/types'

export const getMessageTool: ToolConfig<
  MicrosoftTeamsGetMessageParams,
  MicrosoftTeamsReadResponse
> = {
  id: 'microsoft_teams_get_message',
  name: 'Get Microsoft Teams Message',
  description: 'Get a specific message from a Microsoft Teams chat or channel',
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
      required: false,
      visibility: 'user-or-llm',
      description:
        'The ID of the team for channel messages (e.g., "12345678-abcd-1234-efgh-123456789012" - a GUID)',
    },
    channelId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'The ID of the channel for channel messages (e.g., "19:abc123def456@thread.tacv2")',
    },
    chatId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The ID of the chat for chat messages (e.g., "19:abc123def456@thread.v2")',
    },
    messageId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'The ID of the message to retrieve (e.g., "1234567890123" - a numeric string from message responses)',
    },
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the retrieval was successful' },
    content: { type: 'string', description: 'The message content' },
    metadata: {
      type: 'object',
      description: 'Message metadata including sender, timestamp, etc.',
      properties: {
        messageId: { type: 'string', description: 'Message ID' },
        content: { type: 'string', description: 'Message content' },
        createdTime: { type: 'string', description: 'Message creation timestamp' },
        url: { type: 'string', description: 'Web URL to the message' },
        teamId: { type: 'string', description: 'Team ID' },
        channelId: { type: 'string', description: 'Channel ID' },
        chatId: { type: 'string', description: 'Chat ID' },
        messages: { type: 'array', description: 'Array of message details' },
        messageCount: { type: 'number', description: 'Number of messages' },
      },
    },
  },

  request: {
    url: (params) => {
      const messageId = params.messageId?.trim()
      if (!messageId) {
        throw new Error('Message ID is required')
      }

      // Check if it's a channel or chat message
      if (params.teamId && params.channelId) {
        const teamId = params.teamId.trim()
        const channelId = params.channelId.trim()
        return `https://graph.microsoft.com/v1.0/teams/${encodeURIComponent(teamId)}/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}`
      }
      if (params.chatId) {
        const chatId = params.chatId.trim()
        return `https://graph.microsoft.com/v1.0/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}`
      }

      throw new Error('Either (teamId and channelId) or chatId is required')
    },
    method: 'GET',
    headers: (params) => {
      if (!params.accessToken) {
        throw new Error('Access token is required')
      }
      return {
        Authorization: `Bearer ${params.accessToken}`,
      }
    },
  },

  transformResponse: async (response: Response, params?: MicrosoftTeamsGetMessageParams) => {
    const data = await response.json()

    const metadata = {
      messageId: data.id || params?.messageId || '',
      content: data.body?.content || '',
      createdTime: data.createdDateTime || '',
      url: data.webUrl || '',
      teamId: params?.teamId,
      channelId: params?.channelId,
      chatId: params?.chatId,
      messages: [
        {
          id: data.id || '',
          content: data.body?.content || '',
          sender: data.from?.user?.displayName || 'Unknown',
          timestamp: data.createdDateTime || '',
          messageType: data.messageType || 'message',
          attachments: data.attachments || [],
        },
      ],
      messageCount: 1,
    }

    return {
      success: true,
      output: {
        content: data.body?.content || '',
        metadata,
      },
    }
  },
}
