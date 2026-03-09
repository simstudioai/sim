import type { ToolConfig } from '@/tools/types'
import type { EvernoteListNotebooksParams, EvernoteListNotebooksResponse } from './types'

export const evernoteListNotebooksTool: ToolConfig<
  EvernoteListNotebooksParams,
  EvernoteListNotebooksResponse
> = {
  id: 'evernote_list_notebooks',
  name: 'Evernote List Notebooks',
  description: 'List all notebooks in an Evernote account',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Evernote developer token',
    },
  },

  request: {
    url: '/api/tools/evernote/list-notebooks',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      apiKey: params.apiKey,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!data.success) {
      throw new Error(data.error || 'Failed to list notebooks')
    }
    return {
      success: true,
      output: { notebooks: data.output.notebooks },
    }
  },

  outputs: {
    notebooks: {
      type: 'array',
      description: 'List of notebooks',
      properties: {
        guid: { type: 'string', description: 'Notebook GUID' },
        name: { type: 'string', description: 'Notebook name' },
        defaultNotebook: { type: 'boolean', description: 'Whether this is the default notebook' },
        serviceCreated: {
          type: 'number',
          description: 'Creation timestamp in milliseconds',
          optional: true,
        },
        serviceUpdated: {
          type: 'number',
          description: 'Last updated timestamp in milliseconds',
          optional: true,
        },
        stack: { type: 'string', description: 'Notebook stack name', optional: true },
      },
    },
  },
}
