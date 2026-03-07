import type { ToolConfig } from '@/tools/types'
import type { ObsidianAppendNoteParams, ObsidianAppendNoteResponse } from './types'

export const appendNoteTool: ToolConfig<ObsidianAppendNoteParams, ObsidianAppendNoteResponse> = {
  id: 'obsidian_append_note',
  name: 'Obsidian Append to Note',
  description: 'Append content to an existing note in your Obsidian vault',
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
    content: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Markdown content to append to the note',
    },
  },

  request: {
    url: (params) => {
      const base = params.baseUrl.replace(/\/$/, '')
      return `${base}/vault/${params.filename.trim().split('/').map(encodeURIComponent).join('/')}`
    },
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'text/markdown',
    }),
    body: (params) => params.content,
  },

  transformResponse: async (response, params) => {
    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Unknown error' }))
      throw new Error(`Failed to append to note: ${error.message ?? response.statusText}`)
    }
    return {
      success: true,
      output: {
        filename: params?.filename ?? '',
        appended: true,
      },
    }
  },

  outputs: {
    filename: {
      type: 'string',
      description: 'Path of the note',
    },
    appended: {
      type: 'boolean',
      description: 'Whether content was successfully appended',
    },
  },
}
