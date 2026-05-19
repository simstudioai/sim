import type {
  RailwayUpdatedProject,
  RailwayUpdateProjectParams,
  RailwayUpdateProjectResponse,
} from '@/tools/railway/types'
import {
  compactVariables,
  parseRailwayGraphqlResponse,
  RAILWAY_GRAPHQL_URL,
  railwayHeaders,
} from '@/tools/railway/utils'
import type { ToolConfig } from '@/tools/types'

interface RailwayUpdateProjectData {
  projectUpdate?: RailwayUpdatedProject
}

export const railwayUpdateProjectTool: ToolConfig<
  RailwayUpdateProjectParams,
  RailwayUpdateProjectResponse
> = {
  id: 'railway_update_project',
  name: 'Railway Update Project',
  description: 'Update a Railway project name or description',
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
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Updated project name',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Updated project description',
    },
  },

  request: {
    url: RAILWAY_GRAPHQL_URL,
    method: 'POST',
    headers: (params) => railwayHeaders(params.apiKey, params.tokenType),
    body: (params) => ({
      query: `
        mutation UpdateProject($id: String!, $input: ProjectUpdateInput!) {
          projectUpdate(id: $id, input: $input) {
            id
            name
            description
          }
        }
      `,
      variables: {
        id: params.projectId.trim(),
        input: compactVariables({
          name: params.name?.trim(),
          description: params.description?.trim(),
        }),
      },
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await parseRailwayGraphqlResponse<RailwayUpdateProjectData>(response)
    const project = data.data?.projectUpdate
    if (!project) throw new Error('Railway did not return an updated project')

    return {
      success: true,
      output: {
        project: {
          id: project.id,
          name: project.name,
          description: project.description ?? null,
        },
      },
    }
  },

  outputs: {
    project: {
      type: 'object',
      description: 'Updated project',
      properties: {
        id: { type: 'string', description: 'Project ID' },
        name: { type: 'string', description: 'Project name' },
        description: { type: 'string', description: 'Project description', optional: true },
      },
    },
  },
}
