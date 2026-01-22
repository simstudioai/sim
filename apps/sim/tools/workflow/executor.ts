import type { ToolConfig } from '@/tools/types'
import type { WorkflowExecutorParams, WorkflowExecutorResponse } from '@/tools/workflow/types'

/**
 * Tool for executing workflows as blocks within other workflows.
 * This tool is used by the WorkflowBlockHandler to provide the execution capability.
 */
export const workflowExecutorTool: ToolConfig<
  WorkflowExecutorParams,
  WorkflowExecutorResponse['output']
> = {
  id: 'workflow_executor',
  name: 'Workflow Executor',
  description:
    'Execute another workflow as a sub-workflow. Pass inputs as a JSON object with field names matching the child workflow\'s input format. Example: if child expects "name" and "email", pass {"name": "John", "email": "john@example.com"}',
  version: '1.0.0',
  params: {
    workflowId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the workflow to execute',
    },
    inputMapping: {
      type: 'object',
      required: false,
      visibility: 'user-or-llm',
      description:
        'JSON object with keys matching the child workflow\'s input field names. Each key should map to the value you want to pass for that input field. Example: {"fieldName": "value", "otherField": 123}',
    },
  },
  request: {
    url: (params: WorkflowExecutorParams) => `/api/workflows/${params.workflowId}/execute`,
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params: WorkflowExecutorParams) => {
      let inputData = params.inputMapping || {}
      if (typeof inputData === 'string') {
        try {
          inputData = JSON.parse(inputData)
        } catch {
          inputData = {}
        }
      }
      // Use draft state for manual runs (not deployed), deployed state for deployed runs
      const isDeployedContext = params._context?.isDeployedContext
      return {
        input: inputData,
        triggerType: 'api',
        useDraftState: !isDeployedContext,
      }
    },
  },
  transformResponse: async (response: Response) => {
    const data = await response.json()
    const outputData = data?.output ?? {}

    return {
      success: data?.success ?? false,
      duration: data?.metadata?.duration ?? 0,
      childWorkflowId: data?.workflowId ?? '',
      childWorkflowName: data?.workflowName ?? '',
      output: outputData, // For OpenAI provider
      result: outputData, // For backwards compatibility
      error: data?.error,
    }
  },
}
