import type {
  RailwayTransferProjectParams,
  RailwayTransferProjectResponse,
} from '@/tools/railway/types'
import {
  parseRailwayGraphqlResponse,
  RAILWAY_GRAPHQL_URL,
  railwayHeaders,
} from '@/tools/railway/utils'
import type { ToolConfig } from '@/tools/types'

interface RailwayTransferProjectData {
  projectTransfer?: boolean
}

export const railwayTransferProjectTool: ToolConfig<
  RailwayTransferProjectParams,
  RailwayTransferProjectResponse
> = {
  id: 'railway_transfer_project',
  name: 'Railway Transfer Project',
  description: 'Transfer a Railway project to another workspace',
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
    workspaceId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Destination workspace ID',
    },
  },

  request: {
    url: RAILWAY_GRAPHQL_URL,
    method: 'POST',
    headers: (params) => railwayHeaders(params.apiKey, params.tokenType),
    body: (params) => ({
      query: `
        mutation TransferProject($projectId: String!, $input: ProjectTransferInput!) {
          projectTransfer(projectId: $projectId, input: $input)
        }
      `,
      variables: {
        projectId: params.projectId.trim(),
        input: {
          workspaceId: params.workspaceId.trim(),
        },
      },
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await parseRailwayGraphqlResponse<RailwayTransferProjectData>(response)
    if (typeof data.data?.projectTransfer !== 'boolean') {
      throw new Error('Railway did not return a project transfer result')
    }

    return {
      success: true,
      output: {
        success: data.data.projectTransfer,
      },
    }
  },

  outputs: {
    success: {
      type: 'boolean',
      description: 'Whether the project was transferred',
    },
  },
}
