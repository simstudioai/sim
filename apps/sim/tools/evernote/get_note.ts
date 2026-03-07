import type { ToolConfig } from '@/tools/types'
import type { EvernoteGetNoteParams, EvernoteGetNoteResponse } from './types'

export const evernoteGetNoteTool: ToolConfig<EvernoteGetNoteParams, EvernoteGetNoteResponse> = {
  id: 'evernote_get_note',
  name: 'Evernote Get Note',
  description: 'Retrieve a note from Evernote by its GUID',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Evernote developer token',
    },
    noteGuid: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'GUID of the note to retrieve',
    },
    withContent: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to include note content (default: true)',
    },
  },

  request: {
    url: '/api/tools/evernote/get-note',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      apiKey: params.apiKey,
      noteGuid: params.noteGuid,
      withContent: params.withContent ?? true,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!data.success) {
      throw new Error(data.error || 'Failed to get note')
    }
    return {
      success: true,
      output: { note: data.output.note },
    }
  },

  outputs: {
    note: {
      type: 'object',
      description: 'The retrieved note',
      properties: {
        guid: { type: 'string', description: 'Unique identifier of the note' },
        title: { type: 'string', description: 'Title of the note' },
        content: { type: 'string', description: 'ENML content of the note', optional: true },
        contentLength: {
          type: 'number',
          description: 'Length of the note content',
          optional: true,
        },
        notebookGuid: {
          type: 'string',
          description: 'GUID of the containing notebook',
          optional: true,
        },
        tagGuids: { type: 'array', description: 'GUIDs of tags on the note', optional: true },
        tagNames: { type: 'array', description: 'Names of tags on the note', optional: true },
        created: {
          type: 'number',
          description: 'Creation timestamp in milliseconds',
          optional: true,
        },
        updated: {
          type: 'number',
          description: 'Last updated timestamp in milliseconds',
          optional: true,
        },
        active: { type: 'boolean', description: 'Whether the note is active (not in trash)' },
      },
    },
  },
}
