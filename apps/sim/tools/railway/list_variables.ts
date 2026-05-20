import type {
  RailwayListVariablesParams,
  RailwayListVariablesResponse,
} from '@/tools/railway/types'
import {
  compactVariables,
  optionalString,
  parseRailwayGraphqlResponse,
  RAILWAY_GRAPHQL_URL,
  railwayHeaders,
} from '@/tools/railway/utils'
import type { ToolConfig } from '@/tools/types'

interface RailwayListVariablesData {
  variables?: Record<string, string>
}

export const railwayListVariablesTool: ToolConfig<
  RailwayListVariablesParams,
  RailwayListVariablesResponse
> = {
  id: 'railway_list_variables',
  name: 'Railway List Variables',
  description: 'List Railway environment variables for a service or shared environment',
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
      description: 'Railway service ID. Omit for shared environment variables.',
    },
  },

  request: {
    url: RAILWAY_GRAPHQL_URL,
    method: 'POST',
    headers: (params) => railwayHeaders(params.apiKey, params.tokenType),
    body: (params) => ({
      query: `
        query Variables($projectId: String!, $environmentId: String!, $serviceId: String) {
          variables(projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId)
        }
      `,
      variables: compactVariables({
        projectId: params.projectId.trim(),
        environmentId: params.environmentId.trim(),
        serviceId: optionalString(params.serviceId),
      }),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await parseRailwayGraphqlResponse<RailwayListVariablesData>(response)
    const variables = data.data?.variables
    if (!variables) throw new Error('Railway did not return variables')

    return {
      success: true,
      output: {
        variables,
        count: Object.keys(variables).length,
      },
    }
  },

  outputs: {
    variables: {
      type: 'object',
      description: 'Variable names and values',
    },
    count: {
      type: 'number',
      description: 'Number of variables returned',
    },
  },
}
