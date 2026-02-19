import type { ToolConfig } from '@/tools/types'
import type { VercelListTeamsParams, VercelListTeamsResponse } from '@/tools/vercel/types'

export const vercelListTeamsTool: ToolConfig<VercelListTeamsParams, VercelListTeamsResponse> = {
  id: 'vercel_list_teams',
  name: 'Vercel List Teams',
  description: 'List all teams in a Vercel account',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Vercel Access Token',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of teams to return',
    },
    since: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Timestamp in milliseconds to only include teams created since then',
    },
    until: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Timestamp in milliseconds to only include teams created until then',
    },
  },

  request: {
    url: (params: VercelListTeamsParams) => {
      const query = new URLSearchParams()
      if (params.limit) query.set('limit', String(params.limit))
      if (params.since) query.set('since', String(params.since))
      if (params.until) query.set('until', String(params.until))
      const qs = query.toString()
      return `https://api.vercel.com/v2/teams${qs ? `?${qs}` : ''}`
    },
    method: 'GET',
    headers: (params: VercelListTeamsParams) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    const teams = (data.teams ?? []).map((t: any) => ({
      id: t.id ?? null,
      slug: t.slug ?? null,
      name: t.name ?? null,
      avatar: t.avatar ?? null,
      createdAt: t.createdAt ?? null,
      updatedAt: t.updatedAt ?? null,
      creatorId: t.creatorId ?? null,
      membership: t.membership
        ? {
            role: t.membership.role ?? null,
            confirmed: t.membership.confirmed ?? false,
            created: t.membership.created ?? null,
            uid: t.membership.uid ?? null,
            teamId: t.membership.teamId ?? null,
          }
        : null,
    }))

    return {
      success: true,
      output: {
        teams,
        count: teams.length,
        pagination: data.pagination
          ? {
              count: data.pagination.count ?? 0,
              next: data.pagination.next ?? null,
              prev: data.pagination.prev ?? null,
            }
          : null,
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
          id: { type: 'string', description: 'Team ID' },
          slug: { type: 'string', description: 'Team slug' },
          name: { type: 'string', description: 'Team name' },
          avatar: { type: 'string', description: 'Avatar file ID' },
          createdAt: { type: 'number', description: 'Creation timestamp in milliseconds' },
          updatedAt: { type: 'number', description: 'Last update timestamp in milliseconds' },
          creatorId: { type: 'string', description: 'User ID of team creator' },
          membership: {
            type: 'object',
            description: 'Current user membership details',
            properties: {
              role: { type: 'string', description: 'Membership role' },
              confirmed: { type: 'boolean', description: 'Whether membership is confirmed' },
              created: { type: 'number', description: 'Membership creation timestamp' },
              uid: { type: 'string', description: 'User ID of the member' },
              teamId: { type: 'string', description: 'Team ID' },
            },
          },
        },
      },
    },
    count: {
      type: 'number',
      description: 'Number of teams returned',
    },
    pagination: {
      type: 'object',
      description: 'Pagination information',
      properties: {
        count: { type: 'number', description: 'Items in current page' },
        next: { type: 'number', description: 'Timestamp for next page request' },
        prev: { type: 'number', description: 'Timestamp for previous page request' },
      },
    },
  },
}
