import type { LinearListProjectsParams, LinearListProjectsResponse } from '@/tools/linear/types'
import { PAGE_INFO_OUTPUT, PROJECT_DETAIL_OUTPUT_PROPERTIES } from '@/tools/linear/types'
import { linearAuthorizationHeader } from '@/tools/linear/utils'
import type { ToolConfig } from '@/tools/types'

export const linearListProjectsTool: ToolConfig<
  LinearListProjectsParams,
  LinearListProjectsResponse
> = {
  id: 'linear_list_projects',
  name: 'Linear List Projects',
  description: 'List projects in Linear with optional filtering',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'linear',
  },

  params: {
    teamId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by team ID',
    },
    includeArchived: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include archived projects',
    },
    first: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of projects to return (default: 50)',
    },
    after: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Cursor for pagination',
    },
  },

  request: {
    url: 'https://api.linear.app/graphql',
    method: 'POST',
    headers: (params) => {
      if (!params.accessToken) {
        throw new Error('Missing access token for Linear API request')
      }
      return {
        'Content-Type': 'application/json',
        Authorization: linearAuthorizationHeader(params.accessToken),
      }
    },
    body: (params) => {
      const teamId = typeof params.teamId === 'string' ? params.teamId.trim() : ''
      return {
        query: `
          query ListProjects(
            $first: Int
            $after: String
            $includeArchived: Boolean
            $filter: ProjectFilter
          ) {
            projects(
              first: $first
              after: $after
              includeArchived: $includeArchived
              filter: $filter
            ) {
              nodes {
                id
                name
                description
                state
                status {
                  id
                  name
                  type
                }
                priority
                startDate
                targetDate
                completedAt
                canceledAt
                archivedAt
                url
                lead {
                  id
                  name
                }
                teams {
                  nodes {
                    id
                    name
                  }
                }
              }
              pageInfo {
                hasNextPage
                endCursor
              }
            }
          }
        `,
        variables: {
          first: params.first ? Number(params.first) : 50,
          after: params.after?.trim() || undefined,
          includeArchived: params.includeArchived || false,
          filter: teamId ? { accessibleTeams: { some: { id: { eq: teamId } } } } : undefined,
        },
      }
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (data.errors) {
      return {
        success: false,
        error: data.errors[0]?.message || 'Failed to list projects',
        output: {},
      }
    }

    const result = data.data.projects
    const projects = result.nodes.map((project: any) => ({
      id: project.id,
      name: project.name,
      description: project.description,
      state: project.state,
      status: project.status,
      priority: project.priority,
      startDate: project.startDate,
      targetDate: project.targetDate,
      completedAt: project.completedAt,
      canceledAt: project.canceledAt,
      archivedAt: project.archivedAt,
      url: project.url,
      lead: project.lead,
      teams: project.teams?.nodes || [],
    }))

    return {
      success: true,
      output: {
        projects,
        pageInfo: {
          hasNextPage: result.pageInfo.hasNextPage,
          endCursor: result.pageInfo.endCursor,
        },
      },
    }
  },

  outputs: {
    projects: {
      type: 'array',
      description: 'Array of projects',
      items: {
        type: 'object',
        properties: PROJECT_DETAIL_OUTPUT_PROPERTIES,
      },
    },
    pageInfo: PAGE_INFO_OUTPUT,
  },
}
