import type { ToolConfig } from '@/tools/types'
import type { EvernoteSearchNotesParams, EvernoteSearchNotesResponse } from './types'

export const evernoteSearchNotesTool: ToolConfig<
  EvernoteSearchNotesParams,
  EvernoteSearchNotesResponse
> = {
  id: 'evernote_search_notes',
  name: 'Evernote Search Notes',
  description: 'Search for notes in Evernote using the Evernote search grammar',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Evernote developer token',
    },
    query: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Search query using Evernote search grammar (e.g., "tag:work intitle:meeting")',
    },
    notebookGuid: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Restrict search to a specific notebook by GUID',
    },
    offset: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Starting index for results (default: 0)',
    },
    maxNotes: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of notes to return (default: 25)',
    },
  },

  request: {
    url: '/api/tools/evernote/search-notes',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      apiKey: params.apiKey,
      query: params.query,
      notebookGuid: params.notebookGuid || null,
      offset: params.offset ?? 0,
      maxNotes: params.maxNotes ?? 25,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!data.success) {
      throw new Error(data.error || 'Failed to search notes')
    }
    return {
      success: true,
      output: {
        totalNotes: data.output.totalNotes,
        notes: data.output.notes,
      },
    }
  },

  outputs: {
    totalNotes: {
      type: 'number',
      description: 'Total number of matching notes',
    },
    notes: {
      type: 'array',
      description: 'List of matching note metadata',
      properties: {
        guid: { type: 'string', description: 'Note GUID' },
        title: { type: 'string', description: 'Note title', optional: true },
        contentLength: { type: 'number', description: 'Content length in bytes', optional: true },
        created: { type: 'number', description: 'Creation timestamp', optional: true },
        updated: { type: 'number', description: 'Last updated timestamp', optional: true },
        notebookGuid: { type: 'string', description: 'Containing notebook GUID', optional: true },
        tagGuids: { type: 'array', description: 'Tag GUIDs', optional: true },
      },
    },
  },
}
