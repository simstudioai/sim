import type { ToolConfig } from '@/tools/types'
import type { ObsidianGetActiveParams, ObsidianGetActiveResponse } from './types'

export const getActiveTool: ToolConfig<ObsidianGetActiveParams, ObsidianGetActiveResponse> = {
  id: 'obsidian_get_active',
  name: 'Obsidian Get Active File',
  description: 'Retrieve the content of the currently active file in Obsidian',
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
      return `${base}/active/`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      Accept: 'application/vnd.olrapi.note+json',
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        content: data.content ?? '',
        filename: data.path ?? null,
      },
    }
  },

  outputs: {
    content: {
      type: 'string',
      description: 'Markdown content of the active file',
    },
    filename: {
      type: 'string',
      description: 'Path to the active file',
      optional: true,
    },
  },
}
