import type {
  DaytonaExecuteCommandParams,
  DaytonaExecuteCommandResponse,
} from '@/tools/daytona/types'
import { daytonaToolboxUrl, extractDaytonaError, toOptionalNumber } from '@/tools/daytona/utils'
import { transformTable } from '@/tools/shared/table'
import type { ToolConfig } from '@/tools/types'

export const daytonaExecuteCommandTool: ToolConfig<
  DaytonaExecuteCommandParams,
  DaytonaExecuteCommandResponse
> = {
  id: 'daytona_execute_command',
  name: 'Daytona Execute Command',
  description: 'Execute a shell command inside a Daytona sandbox',
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
      description: 'ID of the sandbox to execute the command in',
    },
    command: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Shell command to execute',
    },
    cwd: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Working directory for the command (defaults to the sandbox working directory)',
    },
    env: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Environment variables to set for the command as key-value pairs',
    },
    timeout: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Timeout in seconds (defaults to 10 seconds)',
    },
  },

  request: {
    url: (params) => daytonaToolboxUrl(params.sandboxId, '/process/execute'),
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    }),
    body: (params) => {
      const body: Record<string, unknown> = {
        command: params.command,
      }
      if (params.cwd) body.cwd = params.cwd
      const envs = transformTable(params.env ?? null)
      if (Object.keys(envs).length > 0) body.envs = envs
      const timeout = toOptionalNumber(params.timeout)
      if (timeout !== undefined) body.timeout = timeout
      return body
    },
  },

  transformResponse: async (response) => {
    if (!response.ok) {
      throw new Error(await extractDaytonaError(response, 'Failed to execute command'))
    }
    const data = await response.json()
    return {
      success: true,
      output: {
        exitCode: data.exitCode ?? -1,
        result: data.result ?? '',
      },
    }
  },

  outputs: {
    exitCode: {
      type: 'number',
      description: 'Exit code of the command (-1 if missing from the response)',
    },
    result: { type: 'string', description: 'Combined stdout/stderr output of the command' },
  },
}
