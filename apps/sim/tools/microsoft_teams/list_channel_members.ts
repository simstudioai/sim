import type {
  MicrosoftTeamsListMembersResponse,
  MicrosoftTeamsToolParams,
} from '@/tools/microsoft_teams/types'
import type { ToolConfig } from '@/tools/types'

export const listChannelMembersTool: ToolConfig<
  MicrosoftTeamsToolParams,
  MicrosoftTeamsListMembersResponse
> = {
  id: 'microsoft_teams_list_channel_members',
  name: 'List Microsoft Teams Channel Members',
  description: 'List all members of a Microsoft Teams channel',
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
      visibility: 'user-only',
      description: 'The ID of the team',
    },
    channelId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'The ID of the channel',
    },
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the listing was successful' },
    members: { type: 'array', description: 'Array of channel members' },
    memberCount: { type: 'number', description: 'Total number of members' },
  },

  request: {
    url: (params) => {
      const teamId = params.teamId?.trim()
      const channelId = params.channelId?.trim()
      if (!teamId || !channelId) {
        throw new Error('Team ID and Channel ID are required')
      }
      return `https://graph.microsoft.com/v1.0/teams/${encodeURIComponent(teamId)}/channels/${encodeURIComponent(channelId)}/members`
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

    const members = (data.value || []).map((member: any) => ({
      id: member.id || '',
      displayName: member.displayName || '',
      email: member.email || member.userId || '',
      userId: member.userId || '',
      roles: member.roles || [],
    }))

    return {
      success: true,
      output: {
        members,
        memberCount: members.length,
        metadata: {
          teamId: params?.teamId || '',
          channelId: params?.channelId || '',
        },
      },
    }
  },
}
