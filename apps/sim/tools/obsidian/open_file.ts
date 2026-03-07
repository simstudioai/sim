import type { ToolConfig } from '@/tools/types'
import type { ObsidianOpenFileParams, ObsidianOpenFileResponse } from './types'

export const openFileTool: ToolConfig<ObsidianOpenFileParams, ObsidianOpenFileResponse> = {
  id: 'obsidian_open_file',
  name: 'Obsidian Open File',
  description: 'Open a file in the Obsidian UI (creates the file if it does not exist)',
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
    filename: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Path to the file relative to vault root',
    },
    newLeaf: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to open the file in a new leaf/tab',
    },
  },

  request: {
    url: (params) => {
      const base = params.baseUrl.replace(/\/$/, '')
      const leafParam = params.newLeaf ? '?newLeaf=true' : ''
      return `${base}/open/${params.filename.trim().split('/').map(encodeURIComponent).join('/')}${leafParam}`
    },
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
    }),
  },

  transformResponse: async (response, params) => {
    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Unknown error' }))
      throw new Error(`Failed to open file: ${error.message ?? response.statusText}`)
    }
    return {
      success: true,
      output: {
        filename: params?.filename ?? '',
        opened: true,
      },
    }
  },

  outputs: {
    filename: {
      type: 'string',
      description: 'Path of the opened file',
    },
    opened: {
      type: 'boolean',
      description: 'Whether the file was successfully opened',
    },
  },
}
