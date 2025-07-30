import { createLogger } from '@/lib/logs/console/logger'
import type { ToolConfig, ToolResponse } from '@/tools/types'

const logger = createLogger('WorkflowExecutorTool')

interface WorkflowExecutorParams {
  workflowId: string
  inputMapping?: Record<string, any>
}

interface WorkflowExecutorResponse extends ToolResponse {
  output: {
    success: boolean
    duration: number
    childWorkflowId: string
    childWorkflowName: string
    [key: string]: any
  }
}

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
  description: 'Execute another workflow inline as a block',
  version: '1.0.0',
  params: {
    workflowId: {
      type: 'string',
      required: true,
      description: 'The ID of the workflow to execute',
    },
    inputMapping: {
      type: 'object',
      required: false,
      description: 'JSON object mapping parent data to child workflow inputs',
    },
  },
  request: {
    url: '/api/tools/workflow-executor',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => params,
    isInternalRoute: true,
  },
  transformResponse: async (response: any) => {
    logger.info('Workflow executor tool response received', { response })

    // Extract success state from response, default to false if not present
    const success = response?.success ?? false

    return {
      success,
      duration: response?.duration ?? 0,
      childWorkflowId: response?.childWorkflowId ?? '',
      childWorkflowName: response?.childWorkflowName ?? '',
      ...response,
    }
  },
  transformError: (error: any) => {
    logger.error('Workflow executor tool error:', error)

    return error.message || 'Workflow execution failed'
  },
}
