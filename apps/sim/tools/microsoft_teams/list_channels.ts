import type {
  MicrosoftTeamsListChannelsResponse,
  MicrosoftTeamsToolParams,
} from '@/tools/microsoft_teams/types'
import type { ToolConfig } from '@/tools/types'

export const listChannelsTool: ToolConfig<
  MicrosoftTeamsToolParams,
  MicrosoftTeamsListChannelsResponse
> = {
  id: 'microsoft_teams_list_channels',
  name: 'List Microsoft Teams Channels',
  description: 'List all channels in a Microsoft Teams team',
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
        'The ID of the team (e.g., "12345678-abcd-1234-efgh-123456789012" - a GUID from team listings)',
    },
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the listing was successful' },
    channels: { type: 'array', description: 'Array of channels in the team' },
    channelCount: { type: 'number', description: 'Total number of channels' },
  },

  request: {
    url: (params) => {
      const teamId = params.teamId?.trim()
      if (!teamId) {
        throw new Error('Team ID is required')
      }
      return `https://graph.microsoft.com/v1.0/teams/${encodeURIComponent(teamId)}/channels`
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

  transformResponse: async (response: Response, params?: MicrosoftTeamsToolParams) => {
    const data = await response.json()

    const channels = (data.value || []).map((channel: any) => ({
      id: channel.id || '',
      displayName: channel.displayName || '',
      description: channel.description ?? '',
      membershipType: channel.membershipType || 'standard',
      webUrl: channel.webUrl || '',
    }))

    return {
      success: true,
      output: {
        channels,
        channelCount: channels.length,
        metadata: {
          teamId: params?.teamId || '',
        },
      },
    }
  },
}
