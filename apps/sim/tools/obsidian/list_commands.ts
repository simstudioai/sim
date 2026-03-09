import type { ToolConfig } from '@/tools/types'
import type { ObsidianListCommandsParams, ObsidianListCommandsResponse } from './types'

export const listCommandsTool: ToolConfig<
  ObsidianListCommandsParams,
  ObsidianListCommandsResponse
> = {
  id: 'obsidian_list_commands',
  name: 'Obsidian List Commands',
  description: 'List all available commands in Obsidian',
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
  },

  request: {
    url: (params) => {
      const base = params.baseUrl.replace(/\/$/, '')
      return `${base}/commands/`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      Accept: 'application/json',
    }),
  },

  transformResponse: async (response) => {
    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Unknown error' }))
      throw new Error(`Failed to list commands: ${error.message ?? response.statusText}`)
    }
    const data = await response.json()
    return {
      success: true,
      output: {
        commands:
          data.commands?.map((cmd: { id: string; name: string }) => ({
            id: cmd.id ?? '',
            name: cmd.name ?? '',
          })) ?? [],
      },
    }
  },

  outputs: {
    commands: {
      type: 'json',
      description: 'List of available commands with IDs and names',
      properties: {
        id: { type: 'string', description: 'Command identifier' },
        name: { type: 'string', description: 'Human-readable command name' },
      },
    },
  },
}
