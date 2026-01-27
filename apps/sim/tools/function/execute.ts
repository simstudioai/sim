import { DEFAULT_EXECUTION_TIMEOUT_MS } from '@/lib/execution/constants'
import { DEFAULT_CODE_LANGUAGE } from '@/lib/execution/languages'
import type { CodeExecutionInput, CodeExecutionOutput } from '@/tools/function/types'
import type { ToolConfig } from '@/tools/types'

export const functionExecuteTool: ToolConfig<CodeExecutionInput, CodeExecutionOutput> = {
  id: 'function_execute',
  name: 'Function Execute',
  description:
    'Execute JavaScript code. fetch() is available. Code runs in async IIFE wrapper automatically. CRITICAL: Write plain statements with await/return, NOT wrapped in functions. Example for API call: const res = await fetch(url); const data = await res.json(); return data;',
  version: '1.0.0',

  params: {
    code: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Raw JavaScript statements (NOT a function). Code is auto-wrapped in async context. MUST use fetch() for HTTP (NOT xhr/axios/request libs). Write like: await fetch(url) then return result. NO import/require statements.',
    },
    language: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Language to execute (javascript or python)',
      default: DEFAULT_CODE_LANGUAGE,
    },
    timeout: {
      type: 'number',
      required: false,
      visibility: 'hidden',
      description: 'Execution timeout in milliseconds',
      default: DEFAULT_EXECUTION_TIMEOUT_MS,
    },
    envVars: {
      type: 'object',
      required: false,
      visibility: 'hidden',
      description: 'Environment variables to make available during execution',
      default: {},
    },
    blockData: {
      type: 'object',
      required: false,
      visibility: 'hidden',
      description: 'Block output data for variable resolution',
      default: {},
    },
    blockNameMapping: {
      type: 'object',
      required: false,
      visibility: 'hidden',
      description: 'Mapping of block names to block IDs',
      default: {},
    },
    blockOutputSchemas: {
      type: 'object',
      required: false,
      visibility: 'hidden',
      description: 'Mapping of block IDs to their output schemas for validation',
      default: {},
    },
    workflowVariables: {
      type: 'object',
      required: false,
      visibility: 'hidden',
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
        language: params.language || DEFAULT_CODE_LANGUAGE,
        timeout: params.timeout || DEFAULT_EXECUTION_TIMEOUT_MS,
        envVars: params.envVars || {},
        workflowVariables: params.workflowVariables || {},
        blockData: params.blockData || {},
        blockNameMapping: params.blockNameMapping || {},
        blockOutputSchemas: params.blockOutputSchemas || {},
        workflowId: params._context?.workflowId,
        userId: params._context?.userId,
        isCustomTool: params.isCustomTool || false,
      }
    },
  },

  transformResponse: async (response: Response): Promise<CodeExecutionOutput> => {
    const result = await response.json()

    if (!result.success) {
      return {
        success: false,
        output: {
          result: null,
          stdout: result.output?.stdout || '',
        },
        error: result.error,
      }
    }

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
