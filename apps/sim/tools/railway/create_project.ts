import type {
  RailwayCreatedResource,
  RailwayCreateProjectParams,
  RailwayCreateProjectResponse,
} from '@/tools/railway/types'
import {
  compactVariables,
  optionalString,
  parseRailwayGraphqlResponse,
  RAILWAY_GRAPHQL_URL,
  railwayHeaders,
} from '@/tools/railway/utils'
import type { ToolConfig } from '@/tools/types'

interface RailwayCreateProjectData {
  projectCreate?: RailwayCreatedResource
}

export const railwayCreateProjectTool: ToolConfig<
  RailwayCreateProjectParams,
  RailwayCreateProjectResponse
> = {
  id: 'railway_create_project',
  name: 'Railway Create Project',
  description: 'Create a Railway project',
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
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Project name',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Project description',
    },
    workspaceId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Workspace ID to create the project in',
    },
    isPublic: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether the project should be publicly visible',
    },
    defaultEnvironmentName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Name for the default environment',
    },
    prDeploys: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to enable pull request deploys',
    },
  },

  request: {
    url: RAILWAY_GRAPHQL_URL,
    method: 'POST',
    headers: (params) => railwayHeaders(params.apiKey, params.tokenType),
    body: (params) => ({
      query: `
        mutation CreateProject($input: ProjectCreateInput!) {
          projectCreate(input: $input) {
            id
            name
          }
        }
      `,
      variables: {
        input: compactVariables({
          name: params.name.trim(),
          description: optionalString(params.description),
          workspaceId: optionalString(params.workspaceId),
          isPublic: params.isPublic,
          defaultEnvironmentName: optionalString(params.defaultEnvironmentName),
          prDeploys: params.prDeploys,
        }),
      },
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await parseRailwayGraphqlResponse<RailwayCreateProjectData>(response)
    const project = data.data?.projectCreate
    if (!project) throw new Error('Railway did not return a created project')

    return {
      success: true,
      output: {
        project: {
          id: project.id,
          name: project.name,
        },
      },
    }
  },

  outputs: {
    project: {
      type: 'object',
      description: 'Created project',
      properties: {
        id: { type: 'string', description: 'Project ID' },
        name: { type: 'string', description: 'Project name' },
      },
    },
  },
}
