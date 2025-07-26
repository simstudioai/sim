import type { ToolConfig, ToolResponse } from '../types'

interface GetWorkflowExamplesParams {
  exampleIds: string[]
}

interface GetWorkflowExamplesResult {
  examples: Record<string, string>
  notFound: string[]
  availableIds: string[]
}

interface GetWorkflowExamplesResponse extends ToolResponse {
  output: GetWorkflowExamplesResult
}

export const getWorkflowExamplesTool: ToolConfig<
  GetWorkflowExamplesParams,
  GetWorkflowExamplesResponse
> = {
  id: 'get_workflow_examples',
  name: 'Getting relevant examples',
  description: 'Get YAML workflow examples by ID to reference when building workflows',
  version: '1.0.0',

  params: {
    exampleIds: {
      type: 'array',
      required: true,
      description: 'Array of example IDs to retrieve',
    },
  },

  request: {
    url: '/api/tools/get-workflow-examples',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      exampleIds: params.exampleIds,
    }),
    isInternalRoute: true,
  },

  transformResponse: async (response: Response): Promise<GetWorkflowExamplesResponse> => {
    if (!response.ok) {
      throw new Error(`Get workflow examples failed: ${response.status} ${response.statusText}`)
    }

    const data = await response.json()

    if (!data.success) {
      throw new Error(data.error || 'Failed to get workflow examples')
    }

    return {
      success: true,
      output: data.data,
    }
  },

  transformError: (error: any): string => {
    console.error('Get workflow examples error:', error)
    return `Failed to get workflow examples: ${error.message || 'Unknown error'}`
  },
}
