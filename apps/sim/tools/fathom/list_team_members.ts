import type {
  FathomListTeamMembersParams,
  FathomListTeamMembersResponse,
} from '@/tools/fathom/types'
import type { ToolConfig } from '@/tools/types'

export const listTeamMembersTool: ToolConfig<
  FathomListTeamMembersParams,
  FathomListTeamMembersResponse
> = {
  id: 'fathom_list_team_members',
  name: 'Fathom List Team Members',
  description: 'List team members in your Fathom organization.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Fathom API Key',
    },
    teams: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Team name to filter by',
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
      const url = new URL('https://api.fathom.ai/external/v1/team_members')
      if (params.teams) url.searchParams.append('team', params.teams)
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
          members: [],
          next_cursor: null,
        },
      }
    }

    const data = await response.json()
    const members = (data.items ?? []).map(
      (member: { name?: string; email?: string; created_at?: string }) => ({
        name: member.name ?? '',
        email: member.email ?? '',
        created_at: member.created_at ?? '',
      })
    )

    return {
      success: true,
      output: {
        members,
        next_cursor: data.next_cursor ?? null,
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
          name: { type: 'string', description: 'Team member name' },
          email: { type: 'string', description: 'Team member email' },
          created_at: { type: 'string', description: 'Date the member was added' },
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
