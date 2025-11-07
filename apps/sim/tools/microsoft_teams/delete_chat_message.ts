import type {
  MicrosoftTeamsDeleteMessageParams,
  MicrosoftTeamsDeleteResponse,
} from '@/tools/microsoft_teams/types'
import type { ToolConfig } from '@/tools/types'

export const deleteChatMessageTool: ToolConfig<
  MicrosoftTeamsDeleteMessageParams,
  MicrosoftTeamsDeleteResponse
> = {
  id: 'microsoft_teams_delete_chat_message',
  name: 'Delete Microsoft Teams Chat Message',
  description: 'Soft delete a message in a Microsoft Teams chat',
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
      description: 'The ID of the chat containing the message',
    },
    messageId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the message to delete',
    },
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the deletion was successful' },
    deleted: { type: 'boolean', description: 'Confirmation of deletion' },
    messageId: { type: 'string', description: 'ID of the deleted message' },
  },

  request: {
    url: (params) => {
      const chatId = params.chatId?.trim()
      const messageId = params.messageId?.trim()
      if (!chatId || !messageId) {
        throw new Error('Chat ID and Message ID are required')
      }
      return '/api/tools/microsoft_teams/delete_chat_message'
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
      return {
        accessToken: params.accessToken,
        chatId: params.chatId,
        messageId: params.messageId,
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
          chatId: params?.chatId || '',
        },
      },
    }
  },
}
