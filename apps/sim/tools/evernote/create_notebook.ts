import type { ToolConfig } from '@/tools/types'
import type { EvernoteCreateNotebookParams, EvernoteCreateNotebookResponse } from './types'

export const evernoteCreateNotebookTool: ToolConfig<
  EvernoteCreateNotebookParams,
  EvernoteCreateNotebookResponse
> = {
  id: 'evernote_create_notebook',
  name: 'Evernote Create Notebook',
  description: 'Create a new notebook in Evernote',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Evernote developer token',
    },
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name for the new notebook',
    },
    stack: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Stack name to group the notebook under',
    },
  },

  request: {
    url: '/api/tools/evernote/create-notebook',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      apiKey: params.apiKey,
      name: params.name,
      stack: params.stack || null,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!data.success) {
      throw new Error(data.error || 'Failed to create notebook')
    }
    return {
      success: true,
      output: { notebook: data.output.notebook },
    }
  },

  outputs: {
    notebook: {
      type: 'object',
      description: 'The created notebook',
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
