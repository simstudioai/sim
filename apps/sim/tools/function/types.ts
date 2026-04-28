import type { CodeLanguage } from '@/lib/execution/languages'
import type { ToolResponse } from '@/tools/types'

export interface CodeExecutionInput {
  code: Array<{ content: string; id: string }> | string
  language?: CodeLanguage
  useLocalVM?: boolean
  timeout?: number
  memoryLimit?: number
  outputPath?: string
  outputFormat?: 'json' | 'csv' | 'txt' | 'md' | 'html'
  outputTable?: string
  outputSandboxPath?: string
  outputMimeType?: string
  envVars?: Record<string, string>
  workflowVariables?: Record<string, unknown>
  blockData?: Record<string, unknown>
  blockNameMapping?: Record<string, string>
  blockOutputSchemas?: Record<string, Record<string, unknown>>
  _context?: {
    workflowId?: string
    userId?: string
    workspaceId?: string
  }
  isCustomTool?: boolean
  _sandboxFiles?: Array<{ path: string; content: string }>
}

export interface CodeExecutionOutput extends ToolResponse {
  output: {
    result: any
    stdout: string
  }
}
