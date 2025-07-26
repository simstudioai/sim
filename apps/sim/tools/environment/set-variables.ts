import type { ToolConfig, ToolResponse } from '@/tools/types'

interface SetEnvironmentVariablesParams {
  variables: Record<string, string>
  _context?: {
    workflowId: string
  }
}

export interface SetEnvironmentVariablesResponse extends ToolResponse {
  output: {
    message: string
    variableCount: number
    variableNames: string[]
  }
}

export const setEnvironmentVariablesTool: ToolConfig<
  SetEnvironmentVariablesParams,
  SetEnvironmentVariablesResponse
> = {
  id: 'set_environment_variables',
  name: 'Set Environment Variables',
  description:
    'Set or update environment variables that can be used in workflows. New variables will be added, and existing variables with the same names will be updated. Other existing variables will be preserved.',
  version: '1.0.0',

  params: {
    variables: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'A key-value object containing the environment variables to set. Example: {"API_KEY": "your-key", "DATABASE_URL": "your-url"}',
    },
  },

  request: {
    url: '/api/environment/variables',
    method: 'PUT',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      variables: params.variables,
      workflowId: params._context?.workflowId,
    }),
    isInternalRoute: true,
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.error || 'Failed to set environment variables')
    }

    return {
      success: true,
      output: data.output,
    }
  },

  transformError: (error: any) => {
    return `Failed to set environment variables: ${error.message || 'Unknown error'}`
  },
}
