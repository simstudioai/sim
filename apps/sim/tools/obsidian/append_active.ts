import type { ToolConfig } from '@/tools/types'
import type { ObsidianAppendActiveParams, ObsidianAppendActiveResponse } from './types'

export const appendActiveTool: ToolConfig<
  ObsidianAppendActiveParams,
  ObsidianAppendActiveResponse
> = {
  id: 'obsidian_append_active',
  name: 'Obsidian Append to Active File',
  description: 'Append content to the currently active file in Obsidian',
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
    content: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Markdown content to append to the active file',
    },
  },

  request: {
    url: (params) => {
      const base = params.baseUrl.replace(/\/$/, '')
      return `${base}/active/`
    },
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'text/markdown',
    }),
    body: (params) => params.content,
  },

  transformResponse: async (response) => {
    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Unknown error' }))
      throw new Error(`Failed to append to active file: ${error.message ?? response.statusText}`)
    }
    return {
      success: true,
      output: {
        appended: true,
      },
    }
  },

  outputs: {
    appended: {
      type: 'boolean',
      description: 'Whether content was successfully appended',
    },
  },
}
