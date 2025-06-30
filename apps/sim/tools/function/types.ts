import type { ToolResponse } from '../types'

export interface CodeExecutionInput {
  code: Array<{ content: string; id: string }> | string
  timeout?: number
  memoryLimit?: number
  envVars?: Record<string, string>
  blockData?: Record<string, any>
  blockNameMapping?: Record<string, string>
  _context?: {
    workflowId?: string
  }
  isCustomTool?: boolean
}

export interface CodeExecutionOutput extends ToolResponse {
  output: {
    result: any
    stdout: string
  }
}
