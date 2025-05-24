import { ToolResponse } from '../types'

export interface CodeExecutionInput {
  code: Array<{ content: string; id: string }> | string
  timeout?: number
  memoryLimit?: number
}

export interface CodeExecutionOutput extends ToolResponse {
  output: {
    result: any
    stdout: string
  }
}
