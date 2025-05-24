import type { ToolConfig } from '../types'
import type { MicrosoftTeamsReadResponse, MicrosoftTeamsToolParams } from './types'

export const readChannelTool: ToolConfig<MicrosoftTeamsToolParams, MicrosoftTeamsReadResponse> = {
  id: 'microsoft_teams_read_channel',
  name: 'Read Microsoft Teams Channel',
  description: 'Read content from a Microsoft Teams channel',
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
      description: 'The ID of the team to read from',
    },
    channelId: {
      type: 'string',
      required: true,
      description: 'The ID of the channel to read from',
    },
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

      // URL encode the IDs to handle special characters
      const encodedTeamId = encodeURIComponent(teamId)
      const encodedChannelId = encodeURIComponent(channelId)

      // Fetch the most recent messages from the channel
      const url = `https://graph.microsoft.com/v1.0/teams/${encodedTeamId}/channels/${encodedChannelId}/messages`

      return url
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
      throw new Error(`Failed to read Microsoft Teams channel: ${errorText}`)
    }

    const data = await response.json()

    // Microsoft Graph API returns messages in a 'value' array
    const messages = data.value || []

    if (messages.length === 0) {
      return {
        success: true,
        output: {
          content: 'No messages found in this channel.',
          metadata: {
            teamId: '',
            channelId: '',
            messageCount: 0,
            messages: [],
          },
        },
      }
    }

    // Format the messages into a readable text
    const formattedMessages = messages
      .map((message: any) => {
        const content = message.body?.content || 'No content'
        const sender = message.from?.user?.displayName || 'Unknown sender'
        const timestamp = message.createdDateTime
          ? new Date(message.createdDateTime).toLocaleString()
          : 'Unknown time'

        return `[${timestamp}] ${sender}: ${content}`
      })
      .join('\n\n')

    // Create document metadata
    const metadata = {
      teamId: messages[0]?.channelIdentity?.teamId || '',
      channelId: messages[0]?.channelIdentity?.channelId || '',
      messageCount: messages.length,
      messages: messages.map((msg: any) => ({
        id: msg.id,
        content: msg.body?.content || '',
        sender: msg.from?.user?.displayName || 'Unknown',
        timestamp: msg.createdDateTime,
        messageType: msg.messageType || 'message',
      })),
    }

    return {
      success: true,
      output: {
        content: formattedMessages,
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
    return 'An error occurred while reading Microsoft Teams channel'
  },
}
