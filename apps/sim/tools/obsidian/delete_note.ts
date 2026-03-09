import type { ToolConfig } from '@/tools/types'
import type { ObsidianDeleteNoteParams, ObsidianDeleteNoteResponse } from './types'

export const deleteNoteTool: ToolConfig<ObsidianDeleteNoteParams, ObsidianDeleteNoteResponse> = {
  id: 'obsidian_delete_note',
  name: 'Obsidian Delete Note',
  description: 'Delete a note from your Obsidian vault',
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
      description: 'Path to the note to delete relative to vault root',
    },
  },

  request: {
    url: (params) => {
      const base = params.baseUrl.replace(/\/$/, '')
      return `${base}/vault/${params.filename.trim().split('/').map(encodeURIComponent).join('/')}`
    },
    method: 'DELETE',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
    }),
  },

  transformResponse: async (response, params) => {
    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Unknown error' }))
      throw new Error(`Failed to delete note: ${error.message ?? response.statusText}`)
    }
    return {
      success: true,
      output: {
        filename: params?.filename ?? '',
        deleted: true,
      },
    }
  },

  outputs: {
    filename: {
      type: 'string',
      description: 'Path of the deleted note',
    },
    deleted: {
      type: 'boolean',
      description: 'Whether the note was successfully deleted',
    },
  },
}
