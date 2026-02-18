import type { ToolConfig } from '@/tools/types'
import type { VercelGetTeamParams, VercelGetTeamResponse } from '@/tools/vercel/types'

export const vercelGetTeamTool: ToolConfig<VercelGetTeamParams, VercelGetTeamResponse> = {
  id: 'vercel_get_team',
  name: 'Vercel Get Team',
  description: 'Get information about a specific Vercel team',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Vercel Access Token',
    },
    teamId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The team ID to retrieve',
    },
  },

  request: {
    url: (params: VercelGetTeamParams) => `https://api.vercel.com/v2/teams/${params.teamId.trim()}`,
    method: 'GET',
    headers: (params: VercelGetTeamParams) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const d = await response.json()

    return {
      success: true,
      output: {
        id: d.id ?? null,
        slug: d.slug ?? null,
        name: d.name ?? null,
        avatar: d.avatar ?? null,
        description: d.description ?? null,
        createdAt: d.createdAt ?? null,
        updatedAt: d.updatedAt ?? null,
        creatorId: d.creatorId ?? null,
        membership: d.membership
          ? {
              uid: d.membership.uid ?? null,
              teamId: d.membership.teamId ?? null,
              role: d.membership.role ?? null,
              confirmed: d.membership.confirmed ?? false,
              created: d.membership.created ?? null,
              createdAt: d.membership.createdAt ?? null,
              accessRequestedAt: d.membership.accessRequestedAt ?? null,
              teamRoles: d.membership.teamRoles ?? [],
              teamPermissions: d.membership.teamPermissions ?? [],
            }
          : null,
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'Team ID' },
    slug: { type: 'string', description: 'Team slug' },
    name: { type: 'string', description: 'Team name' },
    avatar: { type: 'string', description: 'Avatar file ID' },
    description: { type: 'string', description: 'Short team description' },
    createdAt: { type: 'number', description: 'Creation timestamp in milliseconds' },
    updatedAt: { type: 'number', description: 'Last update timestamp in milliseconds' },
    creatorId: { type: 'string', description: 'User ID of team creator' },
    membership: {
      type: 'object',
      description: 'Current user membership details',
      properties: {
        uid: { type: 'string', description: 'User ID of the member' },
        teamId: { type: 'string', description: 'Team ID' },
        role: { type: 'string', description: 'Membership role' },
        confirmed: { type: 'boolean', description: 'Whether membership is confirmed' },
        created: { type: 'number', description: 'Membership creation timestamp' },
        createdAt: { type: 'number', description: 'Membership creation timestamp (milliseconds)' },
        accessRequestedAt: { type: 'number', description: 'When access was requested' },
        teamRoles: { type: 'array', description: 'Team role assignments' },
        teamPermissions: { type: 'array', description: 'Team permission assignments' },
      },
    },
  },
}
