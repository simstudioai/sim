import type { ToolResponse } from '@/tools/types'

export interface WorkflowExecutorParams {
  workflowId: string
  inputMapping?: Record<string, any>
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
