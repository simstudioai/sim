import { ToolConfig } from '../types'
import { MicrosoftTeamsToolParams, MicrosoftTeamsWriteResponse } from './types'

export const writeChatTool: ToolConfig<MicrosoftTeamsToolParams, MicrosoftTeamsWriteResponse> = {
  id: 'microsoft_teams_write_chat',
  name: 'Write to Microsoft Teams Chat',
  description: 'Write or update content in a Microsoft Teams chat',
  version: '1.0',
  oauth: {
    required: true,
    provider: 'microsoft-teams',
  },
  params: {
    accessToken: {
      type: 'string',
      required: true,
      description: 'The access token for the Microsoft Teams API',
    },
   chatId: {
    type: 'string',
    required: true,
    description: 'The ID of the chat to write to',
   },
    content: {
      type: 'string',
      required: true,
      description: 'The content to write to the message',
    },
  },
  request: {
    url: (params) => {
      // Ensure chatId is valid
      const chatId = params.chatId?.trim()
      if (!chatId) {
        throw new Error('Chat ID is required')
      }

      return `https://graph.microsoft.com/v1.0/chats/${chatId}/messages`
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

      console.log('params.content', params.content)
    
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
    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Failed to write Microsoft Teams message: ${errorText}`)
    }

    const data = await response.json()

    // Create document metadata from the response
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
  transformError: (error) => {
    // If it's an Error instance with a message, use that
    if (error instanceof Error) {
      return error.message
    }

    // If it's an object with an error or message property
    if (typeof error === 'object' && error !== null) {
      if (error.error) {
        return typeof error.error === 'string' ? error.error : JSON.stringify(error.error)
      }
      if (error.message) {
        return error.message
      }
    }

    // Default fallback message
    return 'An error occurred while writing Microsoft Teams message'
  },
}
