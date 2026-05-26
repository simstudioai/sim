import type {
  RailwayListProjectsParams,
  RailwayListProjectsResponse,
  RailwayPageInfo,
  RailwayProjectSummary,
} from '@/tools/railway/types'
import {
  compactVariables,
  optionalString,
  parseRailwayGraphqlResponse,
  RAILWAY_GRAPHQL_URL,
  railwayHeaders,
} from '@/tools/railway/utils'
import type { ToolConfig } from '@/tools/types'

interface RailwayListProjectsData {
  projects?: {
    edges?: Array<{
      node?: RailwayProjectSummary
    }>
    pageInfo?: RailwayPageInfo
  }
}

export const railwayListProjectsTool: ToolConfig<
  RailwayListProjectsParams,
  RailwayListProjectsResponse
> = {
  id: 'railway_list_projects',
  name: 'Railway List Projects',
  description: 'List Railway projects visible to the provided token',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Railway API token',
    },
    tokenType: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Railway token type: account, workspace, project, or oauth',
    },
    workspaceId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Workspace ID to list projects from',
    },
    first: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of projects to return',
    },
    after: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Cursor for pagination',
    },
  },

  request: {
    url: RAILWAY_GRAPHQL_URL,
    method: 'POST',
    headers: (params) => railwayHeaders(params.apiKey, params.tokenType),
    body: (params) => ({
      query: `
        query ListProjects($workspaceId: String, $first: Int, $after: String) {
          projects(workspaceId: $workspaceId, first: $first, after: $after) {
            edges {
              node {
                id
                name
                description
                createdAt
                updatedAt
              }
            }
            pageInfo {
              hasNextPage
              endCursor
            }
          }
        }
      `,
      variables: compactVariables({
        workspaceId: optionalString(params.workspaceId),
        first: params.first ? Number(params.first) : undefined,
        after: optionalString(params.after),
      }),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await parseRailwayGraphqlResponse<RailwayListProjectsData>(response)
    const projectConnection = data.data?.projects
    if (!projectConnection) throw new Error('Railway did not return projects')

    const projects = (projectConnection.edges ?? [])
      .map((edge) => edge.node)
      .filter((project): project is RailwayProjectSummary => Boolean(project))
      .map((project) => ({
        id: project.id,
        name: project.name,
        description: project.description ?? null,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt ?? null,
      }))

    return {
      success: true,
      output: {
        projects,
        pageInfo: {
          hasNextPage: projectConnection.pageInfo?.hasNextPage ?? false,
          endCursor: projectConnection.pageInfo?.endCursor ?? null,
        },
        count: projects.length,
      },
    }
  },

  outputs: {
    projects: {
      type: 'array',
      description: 'Railway projects',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Project ID' },
          name: { type: 'string', description: 'Project name' },
          description: { type: 'string', description: 'Project description', optional: true },
          createdAt: { type: 'string', description: 'Project creation timestamp' },
          updatedAt: { type: 'string', description: 'Project update timestamp', optional: true },
        },
      },
    },
    pageInfo: {
      type: 'object',
      description: 'Pagination information',
      properties: {
        hasNextPage: { type: 'boolean', description: 'Whether more projects are available' },
        endCursor: { type: 'string', description: 'Cursor for the next page', optional: true },
      },
    },
    count: {
      type: 'number',
      description: 'Number of projects returned',
    },
  },
}
