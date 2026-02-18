import type { ToolConfig } from '@/tools/types'
import type {
  VercelListTeamMembersParams,
  VercelListTeamMembersResponse,
} from '@/tools/vercel/types'

export const vercelListTeamMembersTool: ToolConfig<
  VercelListTeamMembersParams,
  VercelListTeamMembersResponse
> = {
  id: 'vercel_list_team_members',
  name: 'Vercel List Team Members',
  description: 'List all members of a Vercel team',
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
      description: 'The team ID to list members for',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of members to return',
    },
    role: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Filter by role (OWNER, MEMBER, DEVELOPER, SECURITY, BILLING, VIEWER, VIEWER_FOR_PLUS, CONTRIBUTOR)',
    },
    since: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Timestamp in milliseconds to only include members added since then',
    },
    until: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Timestamp in milliseconds to only include members added until then',
    },
    search: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Search team members by their name, username, and email',
    },
  },

  request: {
    url: (params: VercelListTeamMembersParams) => {
      const query = new URLSearchParams()
      if (params.limit) query.set('limit', String(params.limit))
      if (params.role) query.set('role', params.role.trim())
      if (params.since) query.set('since', String(params.since))
      if (params.until) query.set('until', String(params.until))
      if (params.search) query.set('search', params.search.trim())
      const qs = query.toString()
      return `https://api.vercel.com/v3/teams/${params.teamId.trim()}/members${qs ? `?${qs}` : ''}`
    },
    method: 'GET',
    headers: (params: VercelListTeamMembersParams) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    const members = (data.members ?? []).map((m: any) => ({
      uid: m.uid ?? null,
      email: m.email ?? null,
      username: m.username ?? null,
      name: m.name ?? null,
      avatar: m.avatar ?? null,
      role: m.role ?? null,
      confirmed: m.confirmed ?? false,
      createdAt: m.createdAt ?? null,
      joinedFrom: m.joinedFrom
        ? {
            origin: m.joinedFrom.origin ?? null,
          }
        : null,
    }))

    return {
      success: true,
      output: {
        members,
        count: members.length,
        pagination: data.pagination
          ? {
              hasNext: data.pagination.hasNext ?? false,
              count: data.pagination.count ?? 0,
            }
          : null,
      },
    }
  },

  outputs: {
    members: {
      type: 'array',
      description: 'List of team members',
      items: {
        type: 'object',
        properties: {
          uid: { type: 'string', description: 'Member user ID' },
          email: { type: 'string', description: 'Member email' },
          username: { type: 'string', description: 'Member username' },
          name: { type: 'string', description: 'Member full name' },
          avatar: { type: 'string', description: 'Avatar file ID' },
          role: { type: 'string', description: 'Member role' },
          confirmed: { type: 'boolean', description: 'Whether membership is confirmed' },
          createdAt: { type: 'number', description: 'Join timestamp in milliseconds' },
          joinedFrom: {
            type: 'object',
            description: 'Origin of how the member joined',
            properties: {
              origin: { type: 'string', description: 'Join origin identifier' },
            },
          },
        },
      },
    },
    count: {
      type: 'number',
      description: 'Number of members returned',
    },
    pagination: {
      type: 'object',
      description: 'Pagination information',
      properties: {
        hasNext: { type: 'boolean', description: 'Whether there are more pages' },
        count: { type: 'number', description: 'Items in current page' },
      },
    },
  },
}
