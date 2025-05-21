import { ToolConfig } from '../types'
import { MicrosoftTeamsReadResponse, MicrosoftTeamsToolParams } from './types'

export const readChatTool: ToolConfig<MicrosoftTeamsToolParams, MicrosoftTeamsReadResponse> = {
  id: 'microsoft_teams_read_chat',
  name: 'Read Microsoft Teams Chat',
  description: 'Read content from a Microsoft Teams chat',
  version: '1.0',
  oauth: {
    required: true,
    provider: 'microsoft-teams',
    additionalScopes: ['https://graph.microsoft.com/.default'],
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
      description: 'The ID of the chat to read from',
    },
    content: {
      type: 'string',
      required: true,
      description: 'The content to read from the chat',
    },
  },
  request: {
    url: (params) => {
      // Ensure messageId is valid
      const messageId = params.messageId?.trim()
      if (!messageId) {
        throw new Error('Message ID is required')
      }
      //We can just extract the chats once the user has signed in
      return `https://graph.microsoft.com/v1.0/chats/${params.chatId}/messages`
    },
    method: 'GET',
    headers: (params) => {
      // Validate access token
      if (!params.accessToken) {
        throw new Error('Access token is required')
      }

      return {
        Authorization: `Bearer ${params.accessToken}`,
      }
    },
  },
  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Failed to read Microsoft Teams message: ${errorText}`)
    }

    const data = await response.json()

    // Create document metadata
    const metadata = {
      messageId: data.messageId,
      channelId: data.channelId,
      teamId: data.teamId,
      content: data.body.content,
    }

    return {
      success: true,
      output: {
        content: data.body.content,
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
    return 'An error occurred while reading Microsoft Teams message'
  },
}


