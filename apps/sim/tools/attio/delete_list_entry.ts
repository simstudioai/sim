import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import type { AttioDeleteListEntryParams, AttioDeleteListEntryResponse } from './types'

const logger = createLogger('AttioDeleteListEntry')

export const attioDeleteListEntryTool: ToolConfig<
  AttioDeleteListEntryParams,
  AttioDeleteListEntryResponse
> = {
  id: 'attio_delete_list_entry',
  name: 'Attio Delete List Entry',
  description: 'Remove an entry from an Attio list',
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
    list: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The list ID or slug',
    },
    entryId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The entry ID to delete',
    },
  },

  request: {
    url: (params) => `https://api.attio.com/v2/lists/${params.list}/entries/${params.entryId}`,
    method: 'DELETE',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },

  transformResponse: async (response) => {
    if (!response.ok) {
      const data = await response.json()
      logger.error('Attio API request failed', { data, status: response.status })
      throw new Error(data.message || 'Failed to delete list entry')
    }
    return {
      success: true,
      output: {
        deleted: true,
      },
    }
  },

  outputs: {
    deleted: { type: 'boolean', description: 'Whether the entry was deleted' },
  },
}
