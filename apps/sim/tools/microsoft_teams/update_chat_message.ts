import type {
  MicrosoftTeamsUpdateMessageParams,
  MicrosoftTeamsWriteResponse,
} from '@/tools/microsoft_teams/types'
import type { ToolConfig } from '@/tools/types'

export const updateChatMessageTool: ToolConfig<
  MicrosoftTeamsUpdateMessageParams,
  MicrosoftTeamsWriteResponse
> = {
  id: 'microsoft_teams_update_chat_message',
  name: 'Update Microsoft Teams Chat Message',
  description: 'Update an existing message in a Microsoft Teams chat',
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
      description: 'The ID of the message to update',
    },
    content: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The new content for the message',
    },
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the update was successful' },
    messageId: { type: 'string', description: 'ID of the updated message' },
    updatedContent: { type: 'boolean', description: 'Whether content was successfully updated' },
  },

  request: {
    url: (params) => {
      const chatId = params.chatId?.trim()
      const messageId = params.messageId?.trim()
      if (!chatId || !messageId) {
        throw new Error('Chat ID and Message ID are required')
      }
      return `https://graph.microsoft.com/v1.0/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}`
    },
    method: 'PATCH',
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

  transformResponse: async (response: Response, params?: MicrosoftTeamsUpdateMessageParams) => {
    let data: any = {}
    if (response.status !== 204 && response.headers.get('content-length') !== '0') {
      const text = await response.text()
      if (text) {
        data = JSON.parse(text)
      }
    }

    const metadata = {
      messageId: data.id || params?.messageId || '',
      chatId: params?.chatId || '',
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
