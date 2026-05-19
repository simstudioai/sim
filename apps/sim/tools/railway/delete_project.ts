import type {
  RailwayDeleteProjectParams,
  RailwayDeleteProjectResponse,
} from '@/tools/railway/types'
import {
  parseRailwayGraphqlResponse,
  RAILWAY_GRAPHQL_URL,
  railwayHeaders,
} from '@/tools/railway/utils'
import type { ToolConfig } from '@/tools/types'

interface RailwayDeleteProjectData {
  projectDelete?: boolean
}

export const railwayDeleteProjectTool: ToolConfig<
  RailwayDeleteProjectParams,
  RailwayDeleteProjectResponse
> = {
  id: 'railway_delete_project',
  name: 'Railway Delete Project',
  description: 'Delete a Railway project',
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
        mutation DeleteProject($id: String!) {
          projectDelete(id: $id)
        }
      `,
      variables: {
        id: params.projectId.trim(),
      },
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await parseRailwayGraphqlResponse<RailwayDeleteProjectData>(response)
    if (typeof data.data?.projectDelete !== 'boolean') {
      throw new Error('Railway did not return a project deletion result')
    }

    return {
      success: true,
      output: {
        success: data.data.projectDelete,
      },
    }
  },

  outputs: {
    success: {
      type: 'boolean',
      description: 'Whether the project was deleted',
    },
  },
}
