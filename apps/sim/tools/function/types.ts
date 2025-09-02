import type { ToolResponse } from '@/tools/types'

export type CodeLanguage = 'javascript' | 'python'

export interface CodeExecutionInput {
  code: Array<{ content: string; id: string }> | string
  language?: CodeLanguage
  fastMode?: boolean
  timeout?: number
  memoryLimit?: number
  envVars?: Record<string, string>
  workflowVariables?: Record<string, unknown>
  blockData?: Record<string, unknown>
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
