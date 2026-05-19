import type {
  RailwayGetProjectParams,
  RailwayGetProjectResponse,
  RailwayProjectEnvironment,
  RailwayProjectService,
  RailwayProjectSummary,
} from '@/tools/railway/types'
import {
  parseRailwayGraphqlResponse,
  RAILWAY_GRAPHQL_URL,
  railwayHeaders,
} from '@/tools/railway/utils'
import type { ToolConfig } from '@/tools/types'

interface RailwayGetProjectData {
  project?: RailwayProjectSummary & {
    services?: {
      edges?: Array<{
        node?: RailwayProjectService
      }>
    }
    environments?: {
      edges?: Array<{
        node?: RailwayProjectEnvironment
      }>
    }
  }
}

export const railwayGetProjectTool: ToolConfig<RailwayGetProjectParams, RailwayGetProjectResponse> =
  {
    id: 'railway_get_project',
    name: 'Railway Get Project',
    description: 'Get a Railway project with its services and environments',
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
      projectId: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Railway project ID',
      },
    },

    request: {
      url: RAILWAY_GRAPHQL_URL,
      method: 'POST',
      headers: (params) => railwayHeaders(params.apiKey, params.tokenType),
      body: (params) => ({
        query: `
          query GetProject($id: String!) {
            project(id: $id) {
              id
              name
              description
              createdAt
              services {
                edges {
                  node {
                    id
                    name
                    icon
                  }
                }
              }
              environments {
                edges {
                  node {
                    id
                    name
                  }
                }
              }
            }
          }
        `,
        variables: { id: params.projectId.trim() },
      }),
    },

    transformResponse: async (response: Response) => {
      const data = await parseRailwayGraphqlResponse<RailwayGetProjectData>(response)
      const project = data.data?.project
      if (!project) throw new Error('Railway did not return a project')

      const services = (project.services?.edges ?? [])
        .map((edge) => edge.node)
        .filter((service): service is RailwayProjectService => Boolean(service))
        .map((service) => ({
          id: service.id,
          name: service.name,
          icon: service.icon ?? null,
        }))

      const environments = (project.environments?.edges ?? [])
        .map((edge) => edge.node)
        .filter((environment): environment is RailwayProjectEnvironment => Boolean(environment))
        .map((environment) => ({
          id: environment.id,
          name: environment.name,
        }))

      return {
        success: true,
        output: {
          project: {
            id: project.id,
            name: project.name,
            description: project.description ?? null,
            createdAt: project.createdAt,
            services,
            environments,
          },
        },
      }
    },

    outputs: {
      project: {
        type: 'object',
        description: 'Project with services and environments',
        properties: {
          id: { type: 'string', description: 'Project ID' },
          name: { type: 'string', description: 'Project name' },
          description: { type: 'string', description: 'Project description', optional: true },
          createdAt: { type: 'string', description: 'Project creation timestamp' },
          services: {
            type: 'array',
            description: 'Project services',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', description: 'Service ID' },
                name: { type: 'string', description: 'Service name' },
                icon: { type: 'string', description: 'Service icon', optional: true },
              },
            },
          },
          environments: {
            type: 'array',
            description: 'Project environments',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', description: 'Environment ID' },
                name: { type: 'string', description: 'Environment name' },
              },
            },
          },
        },
      },
    },
  }
