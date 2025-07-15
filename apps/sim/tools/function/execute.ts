import type { ToolConfig } from '../types'
import type { CodeExecutionInput, CodeExecutionOutput } from './types'

const DEFAULT_TIMEOUT = 10000 // 10 seconds

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
      visibility: 'user-or-llm',
      description: 'The code to execute',
    },
    timeout: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Execution timeout in milliseconds',
      default: DEFAULT_TIMEOUT,
    },
    envVars: {
      type: 'object',
      required: false,
      visibility: 'user-only',
      description: 'Environment variables to make available during execution',
      default: {},
    },
    blockData: {
      type: 'object',
      required: false,
      visibility: 'user-only',
      description: 'Block output data for variable resolution',
      default: {},
    },
    blockNameMapping: {
      type: 'object',
      required: false,
      visibility: 'user-only',
      description: 'Mapping of block names to block IDs',
      default: {},
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
        envVars: params.envVars || {},
        blockData: params.blockData || {},
        blockNameMapping: params.blockNameMapping || {},
        workflowId: params._context?.workflowId,
        isCustomTool: params.isCustomTool || false,
      }
    },
    isInternalRoute: true,
  },

  transformResponse: async (response: Response): Promise<CodeExecutionOutput> => {
    const result = await response.json()

    if (!response.ok || !result.success) {
      // Create enhanced error with debug information if available
      const error = new Error(result.error || 'Code execution failed')

      // Add debug information to the error object if available
      if (result.debug) {
        Object.assign(error, {
          line: result.debug.line,
          column: result.debug.column,
          errorType: result.debug.errorType,
          stack: result.debug.stack,
          enhancedError: true,
        })
      }

      throw error
    }

    return {
      success: true,
      output: {
        result: result.output.result,
        stdout: result.output.stdout,
      },
    }
  },

  transformError: (error: any) => {
    // If we have enhanced error information, create a more detailed message
    if (error.enhancedError && error.line) {
      return `Line ${error.line}${error.column ? `:${error.column}` : ''} - ${error.message}`
    }
    return error.message || 'Code execution failed'
  },
}
