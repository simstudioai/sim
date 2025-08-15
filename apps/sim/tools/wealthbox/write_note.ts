import type { ToolConfig } from '@/tools/types'
import type { WealthboxWriteParams, WealthboxWriteResponse } from '@/tools/wealthbox/types'
import { formatNoteResponse, validateAndBuildNoteBody } from '@/tools/wealthbox/utils'

export const wealthboxWriteNoteTool: ToolConfig<WealthboxWriteParams, WealthboxWriteResponse> = {
  id: 'wealthbox_write_note',
  name: 'Write Wealthbox Note',
  description: 'Create or update a Wealthbox note',
  version: '1.0.0',

  params: {
    accessToken: {
      type: 'string',
      required: true,
      description: 'The access token for the Wealthbox API',
      visibility: 'hidden',
    },
    content: {
      type: 'string',
      required: true,
      description: 'The main body of the note',
      visibility: 'user-or-llm',
    },
    contactId: {
      type: 'string',
      required: false,
      description: 'ID of contact to link to this note',
      visibility: 'user-only',
    },
  },

  request: {
    url: 'https://api.crmworkspace.com/v1/notes',
    method: 'POST',
    headers: (params) => {
      // Validate access token
      if (!params.accessToken) {
        throw new Error('Access token is required')
      }

      return {
        Authorization: `Bearer ${params.accessToken}`,
        'Content-Type': 'application/json',
      }
    },
    body: (params) => {
      return validateAndBuildNoteBody(params)
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return formatNoteResponse(data)
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Created or updated note data and metadata',
      properties: {
        note: { type: 'object', description: 'Raw note data from Wealthbox' },
        success: { type: 'boolean', description: 'Operation success indicator' },
        metadata: {
          type: 'object',
          description: 'Operation metadata',
          properties: {
            operation: { type: 'string', description: 'The operation performed' },
            itemId: { type: 'string', description: 'ID of the created/updated note' },
            itemType: { type: 'string', description: 'Type of item (note)' },
          },
        },
      },
    },
  },
}
