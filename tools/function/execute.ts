import { ToolConfig, ToolResponse } from '../types'

export interface CodeExecutionInput {
  code: Array<{ content: string; id: string }> | string
  timeout?: number
  memoryLimit?: number
}

export interface CodeExecutionOutput extends ToolResponse {
  output: {
    result: any
    stdout: string
    executionTime: number
  }
}

const DEFAULT_TIMEOUT = 3000 // 3 seconds
const DEFAULT_MEMORY_LIMIT = 512 // 512MB

export const functionExecuteTool: ToolConfig<CodeExecutionInput, CodeExecutionOutput> = {
  id: 'function_execute',
  name: 'Function Execute',
  description:
    'Execute JavaScript code in a secure, sandboxed environment with proper isolation and resource limits.',
  version: '1.0.0',

  params: {
    code: {
      type: 'string',
      required: true,
      description: 'The code to execute',
    },
    timeout: {
      type: 'number',
      required: false,
      description: 'Execution timeout in milliseconds',
      default: DEFAULT_TIMEOUT,
    },
    memoryLimit: {
      type: 'number',
      required: false,
      description: 'Memory limit in MB',
      default: DEFAULT_MEMORY_LIMIT,
    },
  },

  request: {
    url: '/api/function/execute',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params: CodeExecutionInput) => {
      const codeContent = Array.isArray(params.code)
        ? params.code.map((c: { content: string }) => c.content).join('\n')
        : params.code

      return {
        code: codeContent,
        timeout: params.timeout || DEFAULT_TIMEOUT,
        memoryLimit: params.memoryLimit || DEFAULT_MEMORY_LIMIT,
      }
    },
    isInternalRoute: true,
  },

  transformResponse: async (response: Response): Promise<CodeExecutionOutput> => {
    const result = await response.json()

    if (!response.ok || !result.success) {
      throw new Error(result.error || 'Code execution failed')
    }

    return {
      success: true,
      output: {
        result: result.output.result,
        stdout: result.output.stdout,
        executionTime: result.output.executionTime,
      },
    }
  },

  transformError: (error: any) => {
    return error.message || 'Code execution failed'
  },
}
