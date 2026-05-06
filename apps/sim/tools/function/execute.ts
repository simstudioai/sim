import { DEFAULT_EXECUTION_TIMEOUT_MS } from '@/lib/execution/constants'
import { DEFAULT_CODE_LANGUAGE } from '@/lib/execution/languages'
import type { CodeExecutionInput, CodeExecutionOutput } from '@/tools/function/types'
import type { ToolConfig } from '@/tools/types'

export const functionExecuteTool: ToolConfig<CodeExecutionInput, CodeExecutionOutput> = {
  id: 'function_execute',
  name: 'Function Execute',
  description:
    'Execute JavaScript, Python, or shell scripts in a secure sandbox. For JS: fetch() is available, code runs in async IIFE wrapper. For shell: workspace env vars available as $VAR_NAME, pre-installed CLI tools (jq, curl, awscli, psql, gh, etc.). Use outputPath/outputTable to persist returned data, or outputSandboxPath + outputPath to export a file created inside the sandbox into the workspace.',
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
      description: 'Language to execute (javascript, python, or shell)',
      default: DEFAULT_CODE_LANGUAGE,
    },
    timeout: {
      type: 'number',
      required: false,
      visibility: 'hidden',
      description: 'Execution timeout in milliseconds',
      default: DEFAULT_EXECUTION_TIMEOUT_MS,
    },
    outputPath: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description:
        'Write the tool result back to a workspace file, e.g. "files/result.json" or "files/report.csv". Use for text/JSON/CSV/markdown/html outputs.',
    },
    outputFormat: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: 'Optional format override for outputPath (json, csv, txt, md, html).',
    },
    outputTable: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description:
        'Overwrite a workspace table with the code result. The code must return an array of objects.',
    },
    outputSandboxPath: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description:
        'Export a file created inside the sandbox to the workspace. Provide the sandbox file path here and also set outputPath to the workspace destination.',
    },
    outputMimeType: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description:
        'MIME type for the exported file. Required for binary files (e.g. "image/png", "application/pdf"). If omitted, inferred from outputPath extension for text formats.',
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

      const body: Record<string, unknown> = {
        code: codeContent,
        language: params.language || DEFAULT_CODE_LANGUAGE,
        timeout: params.timeout || DEFAULT_EXECUTION_TIMEOUT_MS,
        outputPath: params.outputPath,
        outputFormat: params.outputFormat,
        outputTable: params.outputTable,
        outputSandboxPath: params.outputSandboxPath,
        outputMimeType: params.outputMimeType,
        envVars: params.envVars || {},
        workflowVariables: params.workflowVariables || {},
        blockData: params.blockData || {},
        blockNameMapping: params.blockNameMapping || {},
        blockOutputSchemas: params.blockOutputSchemas || {},
        contextVariables: params.contextVariables || {},
        workflowId: params._context?.workflowId,
        userId: params._context?.userId,
        workspaceId: params._context?.workspaceId,
        isCustomTool: params.isCustomTool || false,
      }

      if (params._sandboxFiles) {
        body._sandboxFiles = params._sandboxFiles
      }

      return body
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
        resources: result.resources,
      }
    }

    return {
      success: true,
      output: {
        result: result.output.result,
        stdout: result.output.stdout,
      },
      resources: result.resources,
    }
  },

  outputs: {
    result: { type: 'string', description: 'The result of the code execution' },
    stdout: { type: 'string', description: 'The standard output of the code execution' },
  },
}
