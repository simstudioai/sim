import type { ToolConfig } from '@/tools/types'
import type { EvernoteUpdateNoteParams, EvernoteUpdateNoteResponse } from './types'

export const evernoteUpdateNoteTool: ToolConfig<
  EvernoteUpdateNoteParams,
  EvernoteUpdateNoteResponse
> = {
  id: 'evernote_update_note',
  name: 'Evernote Update Note',
  description: 'Update an existing note in Evernote',
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
      description: 'GUID of the note to update',
    },
    title: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New title for the note',
    },
    content: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New content for the note (plain text or ENML)',
    },
    notebookGuid: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'GUID of the notebook to move the note to',
    },
    tagNames: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated list of tag names (replaces existing tags)',
    },
  },

  request: {
    url: '/api/tools/evernote/update-note',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      apiKey: params.apiKey,
      noteGuid: params.noteGuid,
      title: params.title || null,
      content: params.content || null,
      notebookGuid: params.notebookGuid || null,
      tagNames: params.tagNames || null,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!data.success) {
      throw new Error(data.error || 'Failed to update note')
    }
    return {
      success: true,
      output: { note: data.output.note },
    }
  },

  outputs: {
    note: {
      type: 'object',
      description: 'The updated note',
      properties: {
        guid: { type: 'string', description: 'Unique identifier of the note' },
        title: { type: 'string', description: 'Title of the note' },
        content: { type: 'string', description: 'ENML content of the note', optional: true },
        notebookGuid: {
          type: 'string',
          description: 'GUID of the containing notebook',
          optional: true,
        },
        tagNames: { type: 'array', description: 'Tag names on the note', optional: true },
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
