import type {
  RailwayUpsertVariableParams,
  RailwayUpsertVariableResponse,
} from '@/tools/railway/types'
import {
  compactVariables,
  optionalString,
  parseRailwayGraphqlResponse,
  RAILWAY_GRAPHQL_URL,
  railwayHeaders,
} from '@/tools/railway/utils'
import type { ToolConfig } from '@/tools/types'

interface RailwayUpsertVariableData {
  variableUpsert?: boolean
}

export const railwayUpsertVariableTool: ToolConfig<
  RailwayUpsertVariableParams,
  RailwayUpsertVariableResponse
> = {
  id: 'railway_upsert_variable',
  name: 'Railway Upsert Variable',
  description: 'Create or update a Railway environment variable',
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
    environmentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Railway environment ID',
    },
    serviceId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Railway service ID. Omit to create or update a shared variable.',
    },
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Variable name',
    },
    value: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Variable value',
    },
    skipDeploys: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to skip automatic redeploys after changing the variable',
    },
  },

  request: {
    url: RAILWAY_GRAPHQL_URL,
    method: 'POST',
    headers: (params) => railwayHeaders(params.apiKey, params.tokenType),
    body: (params) => ({
      query: `
        mutation UpsertVariable($input: VariableUpsertInput!) {
          variableUpsert(input: $input)
        }
      `,
      variables: {
        input: {
          projectId: params.projectId.trim(),
          environmentId: params.environmentId.trim(),
          name: params.name.trim(),
          value: params.value,
          ...compactVariables({
            serviceId: optionalString(params.serviceId),
            skipDeploys: params.skipDeploys,
          }),
        },
      },
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await parseRailwayGraphqlResponse<RailwayUpsertVariableData>(response)
    if (typeof data.data?.variableUpsert !== 'boolean') {
      throw new Error('Railway did not return a variable upsert result')
    }

    return {
      success: true,
      output: {
        success: data.data.variableUpsert,
      },
    }
  },

  outputs: {
    success: {
      type: 'boolean',
      description: 'Whether the variable was created or updated',
    },
  },
}
