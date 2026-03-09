import type { ToolConfig } from '@/tools/types'
import type { EvernoteCopyNoteParams, EvernoteCopyNoteResponse } from './types'

export const evernoteCopyNoteTool: ToolConfig<EvernoteCopyNoteParams, EvernoteCopyNoteResponse> = {
  id: 'evernote_copy_note',
  name: 'Evernote Copy Note',
  description: 'Copy a note to another notebook in Evernote',
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
      description: 'GUID of the note to copy',
    },
    toNotebookGuid: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'GUID of the destination notebook',
    },
  },

  request: {
    url: '/api/tools/evernote/copy-note',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      apiKey: params.apiKey,
      noteGuid: params.noteGuid,
      toNotebookGuid: params.toNotebookGuid,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!data.success) {
      throw new Error(data.error || 'Failed to copy note')
    }
    return {
      success: true,
      output: { note: data.output.note },
    }
  },

  outputs: {
    note: {
      type: 'object',
      description: 'The copied note metadata',
      properties: {
        guid: { type: 'string', description: 'New note GUID' },
        title: { type: 'string', description: 'Note title' },
        notebookGuid: {
          type: 'string',
          description: 'GUID of the destination notebook',
          optional: true,
        },
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
      },
    },
  },
}
