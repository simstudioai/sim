import type { RipplingListTeamsParams, RipplingListTeamsResponse } from '@/tools/rippling/types'
import type { ToolConfig } from '@/tools/types'

export const ripplingListTeamsTool: ToolConfig<RipplingListTeamsParams, RipplingListTeamsResponse> =
  {
    id: 'rippling_list_teams',
    name: 'Rippling List Teams',
    description: 'List all teams in Rippling',
    version: '1.0.0',

    params: {
      apiKey: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'Rippling API key',
      },
      limit: {
        type: 'number',
        required: false,
        visibility: 'user-or-llm',
        description: 'Maximum number of teams to return',
      },
      offset: {
        type: 'number',
        required: false,
        visibility: 'user-or-llm',
        description: 'Offset for pagination',
      },
    },

    request: {
      url: (params) => {
        const query = new URLSearchParams()
        if (params.limit != null) query.set('limit', String(params.limit))
        if (params.offset != null) query.set('offset', String(params.offset))
        const qs = query.toString()
        return `https://api.rippling.com/platform/api/teams${qs ? `?${qs}` : ''}`
      },
      method: 'GET',
      headers: (params) => ({
        Authorization: `Bearer ${params.apiKey}`,
        Accept: 'application/json',
      }),
    },

    transformResponse: async (response: Response) => {
      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Rippling API error (${response.status}): ${errorText}`)
      }

      const data = await response.json()
      const results = Array.isArray(data) ? data : (data.results ?? [])

      const teams = results.map((team: Record<string, unknown>) => ({
        id: (team.id as string) ?? '',
        name: (team.name as string) ?? null,
        parent: (team.parent as string) ?? null,
      }))

      return {
        success: true,
        output: {
          teams,
          totalCount: teams.length,
        },
      }
    },

    outputs: {
      teams: {
        type: 'array',
        description: 'List of teams',
        items: {
          type: 'json',
          properties: {
            id: { type: 'string', description: 'Team ID' },
            name: { type: 'string', description: 'Team name' },
            parent: { type: 'string', description: 'Parent team ID' },
          },
        },
      },
      totalCount: {
        type: 'number',
        description: 'Number of teams returned on this page',
      },
    },
  }
