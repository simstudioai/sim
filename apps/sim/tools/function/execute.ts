import type { CodeExecutionInput, CodeExecutionOutput } from '@/tools/function/types'
import type { ToolConfig } from '@/tools/types'

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
    workflowVariables: {
      type: 'object',
      required: false,
      visibility: 'user-only',
      description: 'Workflow variables for <variable.name> resolution',
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
        workflowVariables: params.workflowVariables || {},
        blockData: params.blockData || {},
        blockNameMapping: params.blockNameMapping || {},
        workflowId: params._context?.workflowId,
        isCustomTool: params.isCustomTool || false,
      }
    },
  },

  transformResponse: async (response: Response): Promise<CodeExecutionOutput> => {
    const result = await response.json()

    return {
      success: true,
      output: {
        result: result.output.result,
        stdout: result.output.stdout,
      },
    }
  },

  outputs: {
    result: { type: 'string', description: 'The result of the code execution' },
    stdout: { type: 'string', description: 'The standard output of the code execution' },
  },
}
