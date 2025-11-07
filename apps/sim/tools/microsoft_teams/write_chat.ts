import type {
  MicrosoftTeamsToolParams,
  MicrosoftTeamsWriteResponse,
} from '@/tools/microsoft_teams/types'
import type { ToolConfig } from '@/tools/types'

export const writeChatTool: ToolConfig<MicrosoftTeamsToolParams, MicrosoftTeamsWriteResponse> = {
  id: 'microsoft_teams_write_chat',
  name: 'Write to Microsoft Teams Chat',
  description: 'Write or update content in a Microsoft Teams chat',
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
    chatId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'The ID of the chat to write to',
    },
    content: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The content to write to the message',
    },
    files: {
      type: 'file[]',
      required: false,
      visibility: 'user-only',
      description: 'Files to attach to the message',
    },
  },

  outputs: {
    success: { type: 'boolean', description: 'Teams chat message send success status' },
    messageId: { type: 'string', description: 'Unique identifier for the sent message' },
    chatId: { type: 'string', description: 'ID of the chat where message was sent' },
    createdTime: { type: 'string', description: 'Timestamp when message was created' },
    url: { type: 'string', description: 'Web URL to the message' },
    updatedContent: { type: 'boolean', description: 'Whether content was successfully updated' },
  },

  request: {
    url: (params) => {
      // Ensure chatId is valid
      const chatId = params.chatId?.trim()
      if (!chatId) {
        throw new Error('Chat ID is required')
      }

      // If files are provided, use custom API route for attachment handling
      if (params.files && params.files.length > 0) {
        return '/api/tools/microsoft_teams/write_chat'
      }

      // If content contains mentions, use custom API route for mention resolution
      const hasMentions = /<at>[^<]+<\/at>/i.test(params.content || '')
      if (hasMentions) {
        return '/api/tools/microsoft_teams/write_chat'
      }

      return `https://graph.microsoft.com/v1.0/chats/${encodeURIComponent(chatId)}/messages`
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
          chatId: params.chatId,
          content: params.content,
          files: params.files,
        }
      }

      if (hasMentions) {
        return {
          accessToken: params.accessToken,
          chatId: params.chatId,
          content: params.content,
        }
      }

      // Microsoft Teams API expects this specific format
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
      chatId: data.chatId || '',
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
