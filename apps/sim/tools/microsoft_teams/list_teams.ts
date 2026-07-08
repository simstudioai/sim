import type {
  MicrosoftTeamsListTeamsResponse,
  MicrosoftTeamsToolParams,
} from '@/tools/microsoft_teams/types'
import type { ToolConfig } from '@/tools/types'

export const listTeamsTool: ToolConfig<MicrosoftTeamsToolParams, MicrosoftTeamsListTeamsResponse> =
  {
    id: 'microsoft_teams_list_teams',
    name: 'List Microsoft Teams',
    description: 'List the Microsoft Teams the current user is a direct member of',
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
    },

    outputs: {
      success: { type: 'boolean', description: 'Whether the listing was successful' },
      teams: { type: 'array', description: 'Array of teams the user is a member of' },
      teamCount: { type: 'number', description: 'Total number of teams' },
      hasMore: {
        type: 'boolean',
        description: 'Whether Graph indicated additional pages beyond this response',
      },
    },

    request: {
      // Note: GET /me/joinedTeams does not support OData query parameters ($top, etc.) per Graph docs:
      // https://learn.microsoft.com/en-us/graph/api/user-list-joinedteams
      url: () => 'https://graph.microsoft.com/v1.0/me/joinedTeams',
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

    transformResponse: async (response: Response) => {
      const data = await response.json()

      const teams = (data.value || []).map((team: any) => ({
        id: team.id || '',
        displayName: team.displayName || '',
        description: team.description || '',
        isArchived: Boolean(team.isArchived),
      }))

      return {
        success: true,
        output: {
          teams,
          teamCount: teams.length,
          hasMore: Boolean(data['@odata.nextLink']),
        },
      }
    },
  }
