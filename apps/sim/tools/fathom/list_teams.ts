import type { FathomListTeamsParams, FathomListTeamsResponse } from '@/tools/fathom/types'
import type { ToolConfig } from '@/tools/types'

export const listTeamsTool: ToolConfig<FathomListTeamsParams, FathomListTeamsResponse> = {
  id: 'fathom_list_teams',
  name: 'Fathom List Teams',
  description: 'List teams in your Fathom organization.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Fathom API Key',
    },
    cursor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination cursor from a previous response',
    },
  },

  request: {
    url: (params) => {
      const url = new URL('https://api.fathom.ai/external/v1/teams')
      if (params.cursor) url.searchParams.append('cursor', params.cursor)
      return url.toString()
    },
    method: 'GET',
    headers: (params) => ({
      'X-Api-Key': params.apiKey,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      return {
        success: false,
        error:
          (errorData as Record<string, string>).message ||
          `Fathom API error: ${response.status} ${response.statusText}`,
        output: {
          teams: [],
          next_cursor: null,
        },
      }
    }

    const data = await response.json()
    const teams = (data.items ?? []).map((team: { name?: string; created_at?: string }) => ({
      name: team.name ?? '',
      created_at: team.created_at ?? '',
    }))

    return {
      success: true,
      output: {
        teams,
        next_cursor: data.next_cursor ?? null,
      },
    }
  },

  outputs: {
    teams: {
      type: 'array',
      description: 'List of teams',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Team name' },
          created_at: { type: 'string', description: 'Date the team was created' },
        },
      },
    },
    next_cursor: {
      type: 'string',
      description: 'Pagination cursor for next page',
      optional: true,
    },
  },
}
