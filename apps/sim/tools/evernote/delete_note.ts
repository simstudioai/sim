import type { ToolConfig } from '@/tools/types'
import type { EvernoteDeleteNoteParams, EvernoteDeleteNoteResponse } from './types'

export const evernoteDeleteNoteTool: ToolConfig<
  EvernoteDeleteNoteParams,
  EvernoteDeleteNoteResponse
> = {
  id: 'evernote_delete_note',
  name: 'Evernote Delete Note',
  description: 'Move a note to the trash in Evernote',
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
      description: 'GUID of the note to delete',
    },
  },

  request: {
    url: '/api/tools/evernote/delete-note',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      apiKey: params.apiKey,
      noteGuid: params.noteGuid,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!data.success) {
      throw new Error(data.error || 'Failed to delete note')
    }
    return {
      success: true,
      output: {
        success: true,
        noteGuid: data.output.noteGuid,
      },
    }
  },

  outputs: {
    success: {
      type: 'boolean',
      description: 'Whether the note was successfully deleted',
    },
    noteGuid: {
      type: 'string',
      description: 'GUID of the deleted note',
    },
  },
}
