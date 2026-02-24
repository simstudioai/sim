import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import type { AttioGetListEntryParams, AttioGetListEntryResponse } from './types'
import { LIST_ENTRY_OUTPUT_PROPERTIES } from './types'

const logger = createLogger('AttioGetListEntry')

export const attioGetListEntryTool: ToolConfig<AttioGetListEntryParams, AttioGetListEntryResponse> =
  {
    id: 'attio_get_list_entry',
    name: 'Attio Get List Entry',
    description: 'Get a single list entry by ID',
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
        description: 'The entry ID',
      },
    },

    request: {
      url: (params) => `https://api.attio.com/v2/lists/${params.list}/entries/${params.entryId}`,
      method: 'GET',
      headers: (params) => ({
        Authorization: `Bearer ${params.accessToken}`,
      }),
    },

    transformResponse: async (response) => {
      const data = await response.json()
      if (!response.ok) {
        logger.error('Attio API request failed', { data, status: response.status })
        throw new Error(data.message || 'Failed to get list entry')
      }
      const entry = data.data
      return {
        success: true,
        output: {
          entryId: entry.id?.entry_id ?? null,
          listId: entry.id?.list_id ?? null,
          parentRecordId: entry.parent_record_id ?? null,
          parentObject: entry.parent_object ?? null,
          createdAt: entry.created_at ?? null,
          entryValues: entry.entry_values ?? {},
        },
      }
    },

    outputs: LIST_ENTRY_OUTPUT_PROPERTIES,
  }
