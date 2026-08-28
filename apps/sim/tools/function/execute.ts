import type { FunctionExecuteBody } from '@/lib/api/contracts'
import {
  normalizeRecord,
  normalizeRecordMap,
  normalizeStringRecord,
  normalizeWorkflowVariables,
} from '@/lib/core/utils/records'
import { DEFAULT_EXECUTION_TIMEOUT_MS } from '@/lib/execution/constants'
import { DEFAULT_CODE_LANGUAGE } from '@/lib/execution/languages'
import { PRIVATE_SECRET_PROVENANCE_FIELD } from '@/lib/execution/private-tool-metadata'
import type { CodeExecutionInput, CodeExecutionOutput } from '@/tools/function/types'
import type { InternalToolConfig } from '@/tools/types'

/** Builds the canonical Function protocol body for both HTTP compatibility and in-process calls. */
export function buildFunctionExecuteBody(params: CodeExecutionInput): FunctionExecuteBody {
  const codeContent = Array.isArray(params.code)
    ? params.code.map((entry: { content: string }) => entry.content).join('\n')
    : params.code

  return {
    code: codeContent,
    sourceCode: params.sourceCode,
    language: params.language || DEFAULT_CODE_LANGUAGE,
    timeout: params.timeout || DEFAULT_EXECUTION_TIMEOUT_MS,
    title: params.title,
    outputPath: params.outputPath,
    outputFormat: params.outputFormat,
    outputTable: params.outputTable,
    outputSandboxPath: params.outputSandboxPath,
    outputMimeType: params.outputMimeType,
    sandboxId: params.sandboxId,
    secretScope: params.secretScope,
    mountedSecrets: params.mountedSecrets,
    unredactedSecretNames: params.unredactedSecretNames,
    overwriteFileId: params.overwriteFileId,
    inputs: params.inputs,
    outputs: params.outputs,
    envVars: normalizeStringRecord(params.envVars),
    workflowVariables: normalizeWorkflowVariables(params.workflowVariables),
    blockData: normalizeRecord(params.blockData),
    blockNameMapping: normalizeStringRecord(params.blockNameMapping),
    blockOutputSchemas: normalizeRecordMap(params.blockOutputSchemas),
    contextVariables: normalizeRecord(params.contextVariables),
    workflowId: params._context?.workflowId,
    executionId: params._context?.executionId,
    largeValueExecutionIds: params._context?.largeValueExecutionIds,
    largeValueKeys: params._context?.largeValueKeys,
    fileKeys: params._context?.fileKeys,
    allowLargeValueWorkflowScope: params._context?.allowLargeValueWorkflowScope,
    userId: params._context?.userId,
    workspaceId: params._context?.workspaceId,
    isCustomTool: params.isCustomTool || false,
    ...(params[PRIVATE_SECRET_PROVENANCE_FIELD]
      ? { [PRIVATE_SECRET_PROVENANCE_FIELD]: params[PRIVATE_SECRET_PROVENANCE_FIELD] }
      : {}),
    ...(params._sandboxFiles ? { _sandboxFiles: params._sandboxFiles } : {}),
  }
}

export const functionExecuteTool: InternalToolConfig<CodeExecutionInput, CodeExecutionOutput> = {
  id: 'function_execute',
  name: 'Function Execute',
  description:
    'Execute JavaScript, Python, or shell scripts in a secure sandbox. For JS: fetch() is available, code runs in an async IIFE wrapper. Shell includes general utilities such as jq, curl, git, and rg. Use outputPath/outputTable to persist returned data, or outputSandboxPath + outputPath to export a file created inside the sandbox into the workspace.',
  version: '1.0.0',

  params: {
    code: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Source code in the selected language. JavaScript runs as an async function body and returns a result with return. Python runs as a module and returns an optional result through __sim_result__; legacy snippets with a top-level return remain supported. Shell runs as Bash and can emit a typed result with __SIM_RESULT__=<json>.',
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
    title: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: 'Short user-visible label for this execution.',
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
    overwriteFileId: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description:
        'Overwrite this existing workspace file ID instead of creating a duplicate output file.',
    },
    sandboxId: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Workspace sandbox providing importable packages and CLI tools',
    },
    secretScope: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Whether this code can read all workspace secrets or only selected ones',
    },
    mountedSecrets: {
      type: 'json',
      required: false,
      visibility: 'user-only',
      description: 'Secret names this code can read when secretScope is "selected"',
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

  operation: {
    input: buildFunctionExecuteBody,
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
        retryable: result.retryable,
        resources: result.resources,
        largeValueKeys: result.largeValueKeys,
        fileKeys: result.fileKeys,
      }
    }

    return {
      success: true,
      output: {
        result: result.output.result,
        stdout: result.output.stdout,
      },
      resources: result.resources,
      largeValueKeys: result.largeValueKeys,
      fileKeys: result.fileKeys,
      retryable: result.retryable,
    }
  },

  outputs: {
    result: { type: 'json', description: 'The structured result emitted by the executed code' },
    stdout: { type: 'string', description: 'The standard output of the code execution' },
  },
}
