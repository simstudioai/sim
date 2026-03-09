import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import type { AttioDeleteNoteParams, AttioDeleteNoteResponse } from './types'

const logger = createLogger('AttioDeleteNote')

export const attioDeleteNoteTool: ToolConfig<AttioDeleteNoteParams, AttioDeleteNoteResponse> = {
  id: 'attio_delete_note',
  name: 'Attio Delete Note',
  description: 'Delete a note from Attio',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'attio',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'The OAuth access token for the Attio API',
    },
    noteId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the note to delete',
    },
  },

  request: {
    url: (params) => `https://api.attio.com/v2/notes/${params.noteId}`,
    method: 'DELETE',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },

  transformResponse: async (response) => {
    if (!response.ok) {
      const data = await response.json()
      logger.error('Attio API request failed', { data, status: response.status })
      throw new Error(data.message || 'Failed to delete note')
    }
    return {
      success: true,
      output: {
        deleted: true,
      },
    }
  },

  outputs: {
    deleted: { type: 'boolean', description: 'Whether the note was deleted' },
  },
}
