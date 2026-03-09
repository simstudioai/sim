import type { ToolConfig } from '@/tools/types'
import type { EvernoteGetNotebookParams, EvernoteGetNotebookResponse } from './types'

export const evernoteGetNotebookTool: ToolConfig<
  EvernoteGetNotebookParams,
  EvernoteGetNotebookResponse
> = {
  id: 'evernote_get_notebook',
  name: 'Evernote Get Notebook',
  description: 'Retrieve a notebook from Evernote by its GUID',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Evernote developer token',
    },
    notebookGuid: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'GUID of the notebook to retrieve',
    },
  },

  request: {
    url: '/api/tools/evernote/get-notebook',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      apiKey: params.apiKey,
      notebookGuid: params.notebookGuid,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!data.success) {
      throw new Error(data.error || 'Failed to get notebook')
    }
    return {
      success: true,
      output: { notebook: data.output.notebook },
    }
  },

  outputs: {
    notebook: {
      type: 'object',
      description: 'The retrieved notebook',
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
