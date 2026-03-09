import type { SentryListProjectsParams, SentryListProjectsResponse } from '@/tools/sentry/types'
import type { ToolConfig } from '@/tools/types'

export const listProjectsTool: ToolConfig<SentryListProjectsParams, SentryListProjectsResponse> = {
  id: 'sentry_projects_list',
  name: 'List Projects',
  description:
    'List all projects in a Sentry organization. Returns project details including name, platform, teams, and configuration.',
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
      description: 'Number of projects to return per page (default: 25, max: 100)',
    },
  },

  request: {
    url: (params) => {
      const baseUrl = `https://sentry.io/api/0/organizations/${params.organizationSlug}/projects/`
      const queryParams: string[] = []

      if (params.cursor && params.cursor !== null && params.cursor !== '') {
        queryParams.push(`cursor=${encodeURIComponent(params.cursor)}`)
      }

      if (params.limit && params.limit !== null) {
        queryParams.push(`limit=${Number(params.limit)}`)
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

    // Extract pagination info from Link header
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

    return {
      success: true,
      output: {
        projects: data.map((project: any) => ({
          id: project.id,
          slug: project.slug,
          name: project.name,
          platform: project.platform ?? null,
          dateCreated: project.dateCreated,
          isBookmarked: project.isBookmarked,
          isMember: project.isMember,
          features: project.features || [],
          firstEvent: project.firstEvent ?? null,
          firstTransactionEvent: project.firstTransactionEvent ?? null,
          access: project.access || [],
          hasAccess: project.hasAccess,
          hasMinifiedStackTrace: project.hasMinifiedStackTrace,
          hasMonitors: project.hasMonitors,
          hasProfiles: project.hasProfiles,
          hasReplays: project.hasReplays,
          hasSessions: project.hasSessions,
          isInternal: project.isInternal,
          organization: {
            id: project.organization?.id || '',
            slug: project.organization?.slug || '',
            name: project.organization?.name || '',
          },
          team: {
            id: project.team?.id || '',
            name: project.team?.name || '',
            slug: project.team?.slug || '',
          },
          teams:
            project.teams?.map((team: any) => ({
              id: team.id,
              name: team.name,
              slug: team.slug,
            })) || [],
          status: project.status ?? null,
          color: project.color ?? null,
          isPublic: project.isPublic,
        })),
        metadata: {
          nextCursor,
          hasMore,
        },
      },
    }
  },

  outputs: {
    projects: {
      type: 'array',
      description: 'List of Sentry projects',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Unique project ID' },
          slug: { type: 'string', description: 'URL-friendly project identifier' },
          name: { type: 'string', description: 'Project name' },
          platform: {
            type: 'string',
            description: 'Platform/language (e.g., javascript, python)',
            optional: true,
          },
          dateCreated: {
            type: 'string',
            description: 'When the project was created (ISO timestamp)',
          },
          isBookmarked: { type: 'boolean', description: 'Whether the project is bookmarked' },
          isMember: { type: 'boolean', description: 'Whether the user is a member of the project' },
          features: { type: 'array', description: 'Enabled features for the project' },
          organization: {
            type: 'object',
            description: 'Organization information',
            properties: {
              id: { type: 'string', description: 'Organization ID' },
              slug: { type: 'string', description: 'Organization slug' },
              name: { type: 'string', description: 'Organization name' },
            },
          },
          teams: {
            type: 'array',
            description: 'Teams associated with the project',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', description: 'Team ID' },
                name: { type: 'string', description: 'Team name' },
                slug: { type: 'string', description: 'Team slug' },
              },
            },
          },
          status: { type: 'string', description: 'Project status', optional: true },
          isPublic: { type: 'boolean', description: 'Whether the project is publicly visible' },
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
