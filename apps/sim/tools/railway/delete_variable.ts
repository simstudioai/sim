import { filterUndefined } from '@sim/utils/object'
import type {
  RailwayDeleteVariableParams,
  RailwayDeleteVariableResponse,
} from '@/tools/railway/types'
import {
  optionalString,
  parseRailwayGraphqlResponse,
  RAILWAY_GRAPHQL_URL,
  railwayHeaders,
} from '@/tools/railway/utils'
import type { ToolConfig } from '@/tools/types'

interface RailwayDeleteVariableData {
  variableDelete?: boolean
}

export const railwayDeleteVariableTool: ToolConfig<
  RailwayDeleteVariableParams,
  RailwayDeleteVariableResponse
> = {
  id: 'railway_delete_variable',
  name: 'Railway Delete Variable',
  description: 'Delete a Railway environment variable',
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
    projectId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Railway project ID',
    },
    environmentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Railway environment ID',
    },
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Variable name to delete',
    },
    serviceId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Railway service ID. Omit to delete a shared variable.',
    },
  },

  request: {
    url: RAILWAY_GRAPHQL_URL,
    method: 'POST',
    headers: (params) => railwayHeaders(params.apiKey, params.tokenType),
    body: (params) => ({
      query: `
        mutation DeleteVariable($input: VariableDeleteInput!) {
          variableDelete(input: $input)
        }
      `,
      variables: {
        input: {
          projectId: params.projectId.trim(),
          environmentId: params.environmentId.trim(),
          name: params.name.trim(),
          ...filterUndefined({
            serviceId: optionalString(params.serviceId),
          }),
        },
      },
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await parseRailwayGraphqlResponse<RailwayDeleteVariableData>(response)
    if (typeof data.data?.variableDelete !== 'boolean') {
      throw new Error('Railway did not return a variable deletion result')
    }

    return {
      success: true,
      output: {
        success: data.data.variableDelete,
      },
    }
  },

  outputs: {
    success: {
      type: 'boolean',
      description: 'Whether the variable was deleted',
    },
  },
}
