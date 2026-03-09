import type { ToolConfig } from '@/tools/types'
import type { EvernoteCreateTagParams, EvernoteCreateTagResponse } from './types'

export const evernoteCreateTagTool: ToolConfig<EvernoteCreateTagParams, EvernoteCreateTagResponse> =
  {
    id: 'evernote_create_tag',
    name: 'Evernote Create Tag',
    description: 'Create a new tag in Evernote',
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
        description: 'Name for the new tag',
      },
      parentGuid: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'GUID of the parent tag for hierarchy',
      },
    },

    request: {
      url: '/api/tools/evernote/create-tag',
      method: 'POST',
      headers: () => ({ 'Content-Type': 'application/json' }),
      body: (params) => ({
        apiKey: params.apiKey,
        name: params.name,
        parentGuid: params.parentGuid || null,
      }),
    },

    transformResponse: async (response) => {
      const data = await response.json()
      if (!data.success) {
        throw new Error(data.error || 'Failed to create tag')
      }
      return {
        success: true,
        output: { tag: data.output.tag },
      }
    },

    outputs: {
      tag: {
        type: 'object',
        description: 'The created tag',
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
