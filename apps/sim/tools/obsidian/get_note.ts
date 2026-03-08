import type { ToolConfig } from '@/tools/types'
import type { ObsidianGetNoteParams, ObsidianGetNoteResponse } from './types'

export const getNoteTool: ToolConfig<ObsidianGetNoteParams, ObsidianGetNoteResponse> = {
  id: 'obsidian_get_note',
  name: 'Obsidian Get Note',
  description: 'Retrieve the content of a note from your Obsidian vault',
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
      description: 'Path to the note relative to vault root (e.g. "folder/note.md")',
    },
  },

  request: {
    url: (params) => {
      const base = params.baseUrl.replace(/\/$/, '')
      return `${base}/vault/${params.filename.trim().split('/').map(encodeURIComponent).join('/')}`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      Accept: 'text/markdown',
    }),
  },

  transformResponse: async (response, params) => {
    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Unknown error' }))
      throw new Error(`Failed to get note: ${error.message ?? response.statusText}`)
    }
    const content = await response.text()
    return {
      success: true,
      output: {
        content,
        filename: params?.filename ?? '',
      },
    }
  },

  outputs: {
    content: {
      type: 'string',
      description: 'Markdown content of the note',
    },
    filename: {
      type: 'string',
      description: 'Path to the note',
    },
  },
}
