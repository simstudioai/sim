import { ToolConfig } from '../types'
import { CodeExecutionInput, CodeExecutionOutput } from './execute'

const DEFAULT_TIMEOUT = 5000 // 5 seconds

export const webcontainerExecuteTool: ToolConfig<CodeExecutionInput, CodeExecutionOutput> = {
  id: 'webcontainer_execute',
  name: 'WebContainer Execute',
  description:
    'Execute JavaScript code in a secure WebContainer environment with Node.js runtime and full npm package support.',
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
  },

  request: {
    url: '/api/webcontainer',
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
      }
    },
    isInternalRoute: true,
  },

  transformResponse: async (response: Response): Promise<CodeExecutionOutput> => {
    const result = await response.json()

    if (!response.ok || !result.success) {
      throw new Error(result.error || 'WebContainer code execution failed')
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
    return error.message || 'WebContainer code execution failed'
  },
}
