import type {
  RailwayDeleteEnvironmentParams,
  RailwayDeleteEnvironmentResponse,
} from '@/tools/railway/types'
import {
  parseRailwayGraphqlResponse,
  RAILWAY_GRAPHQL_URL,
  railwayHeaders,
} from '@/tools/railway/utils'
import type { ToolConfig } from '@/tools/types'

interface RailwayDeleteEnvironmentData {
  environmentDelete?: boolean
}

export const railwayDeleteEnvironmentTool: ToolConfig<
  RailwayDeleteEnvironmentParams,
  RailwayDeleteEnvironmentResponse
> = {
  id: 'railway_delete_environment',
  name: 'Railway Delete Environment',
  description: 'Delete a Railway project environment',
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
    environmentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Railway environment ID',
    },
  },

  request: {
    url: RAILWAY_GRAPHQL_URL,
    method: 'POST',
    headers: (params) => railwayHeaders(params.apiKey, params.tokenType),
    body: (params) => ({
      query: `
        mutation DeleteEnvironment($id: String!) {
          environmentDelete(id: $id)
        }
      `,
      variables: {
        id: params.environmentId.trim(),
      },
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await parseRailwayGraphqlResponse<RailwayDeleteEnvironmentData>(response)
    if (typeof data.data?.environmentDelete !== 'boolean') {
      throw new Error('Railway did not return an environment deletion result')
    }

    return {
      success: true,
      output: {
        success: data.data.environmentDelete,
      },
    }
  },

  outputs: {
    success: {
      type: 'boolean',
      description: 'Whether the environment was deleted',
    },
  },
}
