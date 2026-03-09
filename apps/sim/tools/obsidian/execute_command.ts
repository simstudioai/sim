import type { ToolConfig } from '@/tools/types'
import type { ObsidianExecuteCommandParams, ObsidianExecuteCommandResponse } from './types'

export const executeCommandTool: ToolConfig<
  ObsidianExecuteCommandParams,
  ObsidianExecuteCommandResponse
> = {
  id: 'obsidian_execute_command',
  name: 'Obsidian Execute Command',
  description: 'Execute a command in Obsidian (e.g. open daily note, toggle sidebar)',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'API key from Obsidian Local REST API plugin settings',
    },
    baseUrl: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Base URL for the Obsidian Local REST API',
    },
    commandId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'ID of the command to execute (use List Commands operation to discover available commands)',
    },
  },

  request: {
    url: (params) => {
      const base = params.baseUrl.replace(/\/$/, '')
      return `${base}/commands/${encodeURIComponent(params.commandId.trim())}/`
    },
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
    }),
  },

  transformResponse: async (response, params) => {
    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Unknown error' }))
      throw new Error(`Failed to execute command: ${error.message ?? response.statusText}`)
    }
    return {
      success: true,
      output: {
        commandId: params?.commandId ?? '',
        executed: true,
      },
    }
  },

  outputs: {
    commandId: {
      type: 'string',
      description: 'ID of the executed command',
    },
    executed: {
      type: 'boolean',
      description: 'Whether the command was successfully executed',
    },
  },
}
