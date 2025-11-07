import type { LinearListProjectsParams, LinearListProjectsResponse } from '@/tools/linear/types'
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
        Authorization: `Bearer ${params.accessToken}`,
      }
    },
    body: (params) => {
      // Note: ProjectFilter does not support filtering by team directly
      // We need to filter projects client-side by team if teamId is provided
      return {
        query: `
          query ListProjects($first: Int, $after: String, $includeArchived: Boolean) {
            projects(first: $first, after: $after, includeArchived: $includeArchived) {
              nodes {
                id
                name
                description
                state
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
          first: params.first || 50,
          after: params.after,
          includeArchived: params.includeArchived || false,
        },
      }
    },
  },

  transformResponse: async (response, params) => {
    const data = await response.json()

    if (data.errors) {
      return {
        success: false,
        error: data.errors[0]?.message || 'Failed to list projects',
        output: {},
      }
    }

    const result = data.data.projects
    let projects = result.nodes.map((project: any) => ({
      id: project.id,
      name: project.name,
      description: project.description,
      state: project.state,
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

    // Filter by teamId client-side if provided
    if (params?.teamId) {
      projects = projects.filter((project: any) =>
        project.teams.some((team: any) => team.id === params.teamId)
      )
    }

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
        properties: {
          id: { type: 'string', description: 'Project ID' },
          name: { type: 'string', description: 'Project name' },
          description: { type: 'string', description: 'Project description' },
          state: { type: 'string', description: 'Project state' },
          priority: { type: 'number', description: 'Project priority' },
          lead: { type: 'object', description: 'Project lead' },
          teams: { type: 'array', description: 'Teams associated with project' },
        },
      },
    },
    pageInfo: {
      type: 'object',
      description: 'Pagination information',
    },
  },
}
