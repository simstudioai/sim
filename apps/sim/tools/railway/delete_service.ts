import type {
  RailwayDeleteServiceParams,
  RailwayDeleteServiceResponse,
} from '@/tools/railway/types'
import {
  parseRailwayGraphqlResponse,
  RAILWAY_GRAPHQL_URL,
  railwayHeaders,
} from '@/tools/railway/utils'
import type { ToolConfig } from '@/tools/types'

interface RailwayDeleteServiceData {
  serviceDelete?: boolean
}

export const railwayDeleteServiceTool: ToolConfig<
  RailwayDeleteServiceParams,
  RailwayDeleteServiceResponse
> = {
  id: 'railway_delete_service',
  name: 'Railway Delete Service',
  description: 'Delete a Railway service and all of its deployments',
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
      description:
        'Railway token type. Use "account" for account, workspace, or OAuth tokens, or "project" for project tokens.',
    },
    serviceId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Railway service ID',
    },
  },

  request: {
    url: RAILWAY_GRAPHQL_URL,
    method: 'POST',
    headers: (params) => railwayHeaders(params.apiKey, params.tokenType),
    body: (params) => ({
      query: `
        mutation DeleteService($id: String!) {
          serviceDelete(id: $id)
        }
      `,
      variables: {
        id: params.serviceId.trim(),
      },
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await parseRailwayGraphqlResponse<RailwayDeleteServiceData>(response)
    if (typeof data.data?.serviceDelete !== 'boolean') {
      throw new Error('Railway did not return a service deletion result')
    }

    return {
      success: true,
      output: {
        success: data.data.serviceDelete,
      },
    }
  },

  outputs: {
    success: {
      type: 'boolean',
      description: 'Whether the service was deleted',
    },
  },
}
