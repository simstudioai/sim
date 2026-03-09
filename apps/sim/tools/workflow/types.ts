import type { ToolResponse } from '@/tools/types'

export interface WorkflowExecutorParams {
  workflowId: string
  /** Can be a JSON string (from tool-input UI) or an object (from LLM args) */
  inputMapping?: Record<string, any> | string
  /** Execution context passed by handlers */
  _context?: {
    workflowId?: string
    workspaceId?: string
    executionId?: string
    isDeployedContext?: boolean
  }
}

export interface WorkflowExecutorResponse extends ToolResponse {
  output: {
    success: boolean
    duration: number
    childWorkflowId: string
    childWorkflowName: string
    [key: string]: any
  }
}
