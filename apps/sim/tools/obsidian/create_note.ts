import type { ToolConfig } from '@/tools/types'
import type { ObsidianCreateNoteParams, ObsidianCreateNoteResponse } from './types'

export const createNoteTool: ToolConfig<ObsidianCreateNoteParams, ObsidianCreateNoteResponse> = {
  id: 'obsidian_create_note',
  name: 'Obsidian Create Note',
  description: 'Create or replace a note in your Obsidian vault',
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
      description: 'Path for the note relative to vault root (e.g. "folder/note.md")',
    },
    content: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Markdown content for the note',
    },
  },

  request: {
    url: (params) => {
      const base = params.baseUrl.replace(/\/$/, '')
      return `${base}/vault/${params.filename.trim().split('/').map(encodeURIComponent).join('/')}`
    },
    method: 'PUT',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'text/markdown',
    }),
    body: (params) => params.content,
  },

  transformResponse: async (response, params) => {
    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Unknown error' }))
      throw new Error(`Failed to create note: ${error.message ?? response.statusText}`)
    }
    return {
      success: true,
      output: {
        filename: params?.filename ?? '',
        created: true,
      },
    }
  },

  outputs: {
    filename: {
      type: 'string',
      description: 'Path of the created note',
    },
    created: {
      type: 'boolean',
      description: 'Whether the note was successfully created',
    },
  },
}
