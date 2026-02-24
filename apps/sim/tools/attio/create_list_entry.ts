import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import type { AttioCreateListEntryParams, AttioCreateListEntryResponse } from './types'
import { LIST_ENTRY_OUTPUT_PROPERTIES } from './types'

const logger = createLogger('AttioCreateListEntry')

export const attioCreateListEntryTool: ToolConfig<
  AttioCreateListEntryParams,
  AttioCreateListEntryResponse
> = {
  id: 'attio_create_list_entry',
  name: 'Attio Create List Entry',
  description: 'Add a record to an Attio list as a new entry',
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
    parentRecordId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The record ID to add to the list',
    },
    parentObject: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The object type slug of the record (e.g. people, companies)',
    },
    entryValues: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'JSON object of entry attribute values',
    },
  },

  request: {
    url: (params) => `https://api.attio.com/v2/lists/${params.list}/entries`,
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const data: Record<string, unknown> = {
        parent_record_id: params.parentRecordId,
        parent_object: params.parentObject,
      }
      if (params.entryValues) {
        try {
          data.entry_values =
            typeof params.entryValues === 'string'
              ? JSON.parse(params.entryValues)
              : params.entryValues
        } catch {
          data.entry_values = {}
        }
      }
      return { data }
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!response.ok) {
      logger.error('Attio API request failed', { data, status: response.status })
      throw new Error(data.message || 'Failed to create list entry')
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
