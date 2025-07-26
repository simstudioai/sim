import type { ToolConfig, ToolResponse } from '@/tools/types'

interface GetEnvironmentVariablesParams {
  _context?: {
    workflowId: string
  }
}

export interface GetEnvironmentVariablesResponse extends ToolResponse {
  output: {
    variableNames: string[]
    count: number
  }
}

export const getEnvironmentVariablesTool: ToolConfig<
  GetEnvironmentVariablesParams,
  GetEnvironmentVariablesResponse
> = {
  id: 'get_environment_variables',
  name: 'Get Environment Variables',
  description:
    'Get a list of available environment variable names that the user has configured. Returns only the variable names, not their values.',
  version: '1.0.0',

  params: {},

  request: {
    url: '/api/environment/variables',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      workflowId: params._context?.workflowId,
    }),
    isInternalRoute: true,
  },
}
