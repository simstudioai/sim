import { ToolConfig } from '../types'
import { MicrosoftTeamsToolParams, MicrosoftTeamsWriteResponse } from './types'

export const writeChannelTool: ToolConfig<MicrosoftTeamsToolParams, MicrosoftTeamsWriteResponse> = {
  id: 'microsoft_teams_write',
  name: 'Write to Microsoft Teams Message',
  description: 'Write or update content in a Microsoft Teams message',
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
    teamId: {
        type: 'string',
        required: true,
        description: 'The ID of the team to write to',
      },
    channelId: {
      type: 'string',
      required: false,
      description: 'The ID of the channel to write to',
    },
    content: {
      type: 'string',
      required: true,
      description: 'The content to write to the message',
    },
  },
  request: {
    url: (params) => {
      // Ensure messageId is valid
      const messageId = params.messageId?.trim()
      if (!messageId) {
        throw new Error('Message ID is required')
      }

      //This writes a message to a channel
      return `https://graph.microsoft.com/v1.0/teams/${params.teamId}/channels/${params.channelId}/messages`
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

      // Following the exact format from the Google Docs API examples
      // Always insert at the end of the document to avoid duplication
      // See: https://developers.google.com/docs/api/reference/rest/v1/documents/request#InsertTextRequest
      const requestBody = {
        requests: [
          {
            insertText: {
              endOfSegmentLocation: {},
              text: params.content,
            },
          },
        ],
      }

      return requestBody
    },
  },
  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Failed to write Microsoft Teams message: ${errorText}`)
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
    return 'An error occurred while reading Microsoft Teams message'
  },
}
