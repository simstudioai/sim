import type { ToolConfig } from '@/tools/types'
import type { WorkflowExecutorParams, WorkflowExecutorResponse } from '@/tools/workflow/types'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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
      visibility: 'user-only',
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

    // The execute endpoint has two response shapes:
    // 1. Standard: { success, executionId, output, error, metadata }
    // 2. Response block: arbitrary user-defined data (no wrapper)
    // Detect standard format via executionId (always a UUID from uuidv4()) + success boolean.
    const isStandardFormat =
      typeof data?.success === 'boolean' &&
      typeof data?.executionId === 'string' &&
      UUID_RE.test(data.executionId)

    const outputData = isStandardFormat ? (data.output ?? {}) : data
    const success = isStandardFormat ? data.success : response.ok

    return {
      success,
      duration: isStandardFormat ? (data?.metadata?.duration ?? 0) : 0,
      childWorkflowId: isStandardFormat ? (data?.workflowId ?? '') : '',
      childWorkflowName: isStandardFormat ? (data?.workflowName ?? '') : '',
      output: outputData,
      result: outputData,
      error: data?.error,
    }
  },
}
