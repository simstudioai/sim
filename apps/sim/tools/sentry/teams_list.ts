import type { SentryListTeamsParams, SentryListTeamsResponse } from '@/tools/sentry/types'
import type { ToolConfig } from '@/tools/types'

export const listTeamsTool: ToolConfig<SentryListTeamsParams, SentryListTeamsResponse> = {
  id: 'sentry_teams_list',
  name: 'List Teams',
  description:
    'List all teams in a Sentry organization. Useful for discovering the team slug required when creating a project. Returns team details including slug, name, member count, and associated projects.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Sentry API authentication token',
    },
    organizationSlug: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The slug of the organization (e.g., "my-org")',
    },
    query: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter teams by name or slug',
    },
    cursor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination cursor for retrieving next page of results',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of teams to return per page (default: 25, max: 100)',
    },
  },

  request: {
    url: (params) => {
      const baseUrl = `https://sentry.io/api/0/organizations/${params.organizationSlug}/teams/`
      const queryParams: string[] = []

      if (params.query && params.query !== null && params.query !== '') {
        queryParams.push(`query=${encodeURIComponent(params.query)}`)
      }

      if (params.cursor && params.cursor !== null && params.cursor !== '') {
        queryParams.push(`cursor=${encodeURIComponent(params.cursor)}`)
      }

      if (params.limit && params.limit !== null) {
        queryParams.push(`per_page=${Number(params.limit)}`)
      }

      return queryParams.length > 0 ? `${baseUrl}?${queryParams.join('&')}` : baseUrl
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    const linkHeader = response.headers.get('Link')
    let nextCursor: string | undefined
    let hasMore = false

    if (linkHeader) {
      const nextMatch = linkHeader.match(
        /<[^>]*cursor=([^&>]+)[^>]*>;\s*rel="next";\s*results="true"/
      )
      if (nextMatch) {
        nextCursor = decodeURIComponent(nextMatch[1])
        hasMore = true
      }
    }

    const teams = Array.isArray(data) ? data : []

    return {
      success: true,
      output: {
        teams: teams.map((team: any) => ({
          id: team.id,
          slug: team.slug,
          name: team.name,
          dateCreated: team.dateCreated,
          isMember: team.isMember,
          teamRole: team.teamRole ?? null,
          hasAccess: team.hasAccess,
          isPending: team.isPending,
          memberCount: team.memberCount || 0,
          projects:
            team.projects?.map((project: any) => ({
              id: project.id,
              slug: project.slug,
              name: project.name,
              platform: project.platform ?? null,
            })) || [],
        })),
        metadata: {
          nextCursor,
          hasMore,
        },
      },
    }
  },

  outputs: {
    teams: {
      type: 'array',
      description: 'List of Sentry teams',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Unique team ID' },
          slug: {
            type: 'string',
            description: 'URL-friendly team identifier (used to own projects)',
          },
          name: { type: 'string', description: 'Team name' },
          dateCreated: {
            type: 'string',
            description: 'When the team was created (ISO timestamp)',
          },
          isMember: { type: 'boolean', description: 'Whether the user is a member of the team' },
          teamRole: {
            type: 'string',
            description: 'The role of the user on the team',
            optional: true,
          },
          hasAccess: { type: 'boolean', description: 'Whether the user has access to this team' },
          isPending: { type: 'boolean', description: 'Whether team membership is pending' },
          memberCount: { type: 'number', description: 'Number of members in the team' },
          projects: {
            type: 'array',
            description: 'Projects owned by this team',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', description: 'Project ID' },
                slug: { type: 'string', description: 'Project slug' },
                name: { type: 'string', description: 'Project name' },
                platform: { type: 'string', description: 'Project platform', optional: true },
              },
            },
          },
        },
      },
    },
    metadata: {
      type: 'object',
      description: 'Pagination metadata',
      properties: {
        nextCursor: {
          type: 'string',
          description: 'Cursor for the next page of results (if available)',
        },
        hasMore: {
          type: 'boolean',
          description: 'Whether there are more results available',
        },
      },
    },
  },
}
