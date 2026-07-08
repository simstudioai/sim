import type { CodeLanguage } from '@/lib/execution/languages'
import type { ToolResponse } from '@/tools/types'

export interface CodeExecutionInput {
  code: Array<{ content: string; id: string }> | string
  /** Original user-authored code used for error display after execution-time reference resolution. */
  sourceCode?: string
  language?: CodeLanguage
  useLocalVM?: boolean
  /**
   * Workflow Function blocks pass milliseconds. Copilot/Mothership tool calls pass seconds
   * and are converted at the request boundary.
   */
  timeout?: number
  memoryLimit?: number
  title?: string
  outputPath?: string
  outputFormat?: 'json' | 'csv' | 'txt' | 'md' | 'html'
  outputTable?: string
  outputSandboxPath?: string
  outputMimeType?: string
  overwriteFileId?: string
  inputs?: {
    files?: Array<{ path: string; sandboxPath?: string }>
    directories?: Array<{ path: string; sandboxPath?: string }>
    tables?: Array<{ path?: string; tableId?: string; sandboxPath?: string }>
  }
  outputs?: {
    files?: Array<{
      path: string
      mode: 'create' | 'overwrite'
      sandboxPath?: string
      format?: 'json' | 'csv' | 'txt' | 'md' | 'html'
      mimeType?: string
    }>
  }
  envVars?: Record<string, string>
  workflowVariables?: Record<string, unknown>
  blockData?: Record<string, unknown>
  blockNameMapping?: Record<string, string>
  blockOutputSchemas?: Record<string, Record<string, unknown>>
  /** Pre-resolved block output variables from the executor, injected as VM globals. */
  contextVariables?: Record<string, unknown>
  _context?: {
    workflowId?: string
    executionId?: string
    largeValueExecutionIds?: string[]
    largeValueKeys?: string[]
    fileKeys?: string[]
    allowLargeValueWorkflowScope?: boolean
    userId?: string
    workspaceId?: string
    copilotToolExecution?: boolean
  }
  isCustomTool?: boolean
  _sandboxFiles?: Array<
    | { type?: 'content'; path: string; content: string; encoding?: 'base64' }
    | { type: 'url'; path: string; url: string }
  >
}

export interface CodeExecutionOutput extends ToolResponse {
  output: {
    result: any
    stdout: string
  }
}
