import type { ToolConfig } from '../types'
import type { MicrosoftTeamsToolParams, MicrosoftTeamsWriteResponse } from './types'

export const writeChannelTool: ToolConfig<MicrosoftTeamsToolParams, MicrosoftTeamsWriteResponse> = {
  id: 'microsoft_teams_write_channel',
  name: 'Write to Microsoft Teams Channel',
  description: 'Write or send a message to a Microsoft Teams channel',
  version: '1.0',
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
      description: 'The ID of the team to write to',
    },
    channelId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'The ID of the channel to write to',
    },
    content: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The content to write to the channel',
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

      const encodedTeamId = encodeURIComponent(teamId)
      const encodedChannelId = encodeURIComponent(channelId)

      const url = `https://graph.microsoft.com/v1.0/teams/${encodedTeamId}/channels/${encodedChannelId}/messages`

      return url
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

      // Microsoft Teams API expects this specific format for channel messages
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
      throw new Error(`Failed to write Microsoft Teams channel message: ${errorText}`)
    }

    const data = await response.json()

    // Create document metadata from the response
    const metadata = {
      messageId: data.id || '',
      teamId: data.channelIdentity?.teamId || '',
      channelId: data.channelIdentity?.channelId || '',
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
    return 'An error occurred while writing Microsoft Teams channel message'
  },
}
