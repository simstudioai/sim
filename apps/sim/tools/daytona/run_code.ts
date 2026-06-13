import type { DaytonaRunCodeParams, DaytonaRunCodeResponse } from '@/tools/daytona/types'
import { daytonaToolboxUrl, extractDaytonaError, toOptionalNumber } from '@/tools/daytona/utils'
import { transformTable } from '@/tools/shared/table'
import type { ToolConfig } from '@/tools/types'

export const daytonaRunCodeTool: ToolConfig<DaytonaRunCodeParams, DaytonaRunCodeResponse> = {
  id: 'daytona_run_code',
  name: 'Daytona Run Code',
  description: 'Run Python, JavaScript, or TypeScript code inside a Daytona sandbox',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Daytona API key',
    },
    sandboxId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the sandbox to run the code in',
    },
    code: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Code to run',
    },
    language: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Language of the code: python, javascript, or typescript',
    },
    env: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Environment variables to set for the run as key-value pairs',
    },
    timeout: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Timeout in seconds (defaults to 10 seconds)',
    },
  },

  request: {
    url: (params) => daytonaToolboxUrl(params.sandboxId, '/process/code-run'),
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    }),
    body: (params) => {
      const body: Record<string, unknown> = {
        code: params.code,
        language: params.language,
      }
      const envs = transformTable(params.env ?? null)
      if (Object.keys(envs).length > 0) body.envs = envs
      const timeout = toOptionalNumber(params.timeout)
      if (timeout !== undefined) body.timeout = timeout
      return body
    },
  },

  transformResponse: async (response) => {
    if (!response.ok) {
      throw new Error(await extractDaytonaError(response, 'Failed to run code'))
    }
    const data = await response.json()
    return {
      success: true,
      output: {
        exitCode: data.exitCode ?? -1,
        result: data.result ?? '',
        artifacts: data.artifacts ?? null,
      },
    }
  },

  outputs: {
    exitCode: {
      type: 'number',
      description: 'Exit code of the code run (-1 if missing from the response)',
    },
    result: { type: 'string', description: 'Combined stdout/stderr output of the code run' },
    artifacts: {
      type: 'json',
      description: 'Artifacts produced by the run (e.g., matplotlib charts)',
      optional: true,
    },
  },
}
