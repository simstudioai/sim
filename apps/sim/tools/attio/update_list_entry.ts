import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import type { AttioUpdateListEntryParams, AttioUpdateListEntryResponse } from './types'
import { LIST_ENTRY_OUTPUT_PROPERTIES } from './types'

const logger = createLogger('AttioUpdateListEntry')

export const attioUpdateListEntryTool: ToolConfig<
  AttioUpdateListEntryParams,
  AttioUpdateListEntryResponse
> = {
  id: 'attio_update_list_entry',
  name: 'Attio Update List Entry',
  description: 'Update entry attribute values on an Attio list entry (appends multiselect values)',
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
      description: 'The entry ID to update',
    },
    entryValues: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'JSON object of entry attribute values to update',
    },
  },

  request: {
    url: (params) => `https://api.attio.com/v2/lists/${params.list}/entries/${params.entryId}`,
    method: 'PATCH',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      let entryValues: Record<string, unknown> = {}
      try {
        entryValues =
          typeof params.entryValues === 'string'
            ? JSON.parse(params.entryValues)
            : params.entryValues
      } catch {
        entryValues = {}
      }
      return { data: { entry_values: entryValues } }
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!response.ok) {
      logger.error('Attio API request failed', { data, status: response.status })
      throw new Error(data.message || 'Failed to update list entry')
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
