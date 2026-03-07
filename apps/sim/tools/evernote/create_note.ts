import type { ToolConfig } from '@/tools/types'
import type { EvernoteCreateNoteParams, EvernoteCreateNoteResponse } from './types'

export const evernoteCreateNoteTool: ToolConfig<
  EvernoteCreateNoteParams,
  EvernoteCreateNoteResponse
> = {
  id: 'evernote_create_note',
  name: 'Evernote Create Note',
  description: 'Create a new note in Evernote',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Evernote developer token',
    },
    title: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Title of the note',
    },
    content: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Content of the note (plain text or ENML)',
    },
    notebookGuid: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'GUID of the notebook to create the note in (defaults to default notebook)',
    },
    tagNames: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated list of tag names to apply',
    },
  },

  request: {
    url: '/api/tools/evernote/create-note',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      apiKey: params.apiKey,
      title: params.title,
      content: params.content,
      notebookGuid: params.notebookGuid || null,
      tagNames: params.tagNames || null,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!data.success) {
      throw new Error(data.error || 'Failed to create note')
    }
    return {
      success: true,
      output: { note: data.output.note },
    }
  },

  outputs: {
    note: {
      type: 'object',
      description: 'The created note',
      properties: {
        guid: { type: 'string', description: 'Unique identifier of the note' },
        title: { type: 'string', description: 'Title of the note' },
        content: { type: 'string', description: 'ENML content of the note', optional: true },
        notebookGuid: {
          type: 'string',
          description: 'GUID of the containing notebook',
          optional: true,
        },
        tagNames: {
          type: 'array',
          description: 'Tag names applied to the note',
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
