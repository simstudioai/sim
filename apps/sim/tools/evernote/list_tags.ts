import type { ToolConfig } from '@/tools/types'
import type { EvernoteListTagsParams, EvernoteListTagsResponse } from './types'

export const evernoteListTagsTool: ToolConfig<EvernoteListTagsParams, EvernoteListTagsResponse> = {
  id: 'evernote_list_tags',
  name: 'Evernote List Tags',
  description: 'List all tags in an Evernote account',
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
    url: '/api/tools/evernote/list-tags',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      apiKey: params.apiKey,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!data.success) {
      throw new Error(data.error || 'Failed to list tags')
    }
    return {
      success: true,
      output: { tags: data.output.tags },
    }
  },

  outputs: {
    tags: {
      type: 'array',
      description: 'List of tags',
      properties: {
        guid: { type: 'string', description: 'Tag GUID' },
        name: { type: 'string', description: 'Tag name' },
        parentGuid: { type: 'string', description: 'Parent tag GUID', optional: true },
        updateSequenceNum: {
          type: 'number',
          description: 'Update sequence number',
          optional: true,
        },
      },
    },
  },
}
