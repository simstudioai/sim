import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import type { AttioQueryListEntriesParams, AttioQueryListEntriesResponse } from './types'
import { LIST_ENTRY_OUTPUT_PROPERTIES } from './types'

const logger = createLogger('AttioQueryListEntries')

export const attioQueryListEntriesTool: ToolConfig<
  AttioQueryListEntriesParams,
  AttioQueryListEntriesResponse
> = {
  id: 'attio_query_list_entries',
  name: 'Attio Query List Entries',
  description: 'Query entries in an Attio list with optional filter, sort, and pagination',
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
    filter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'JSON filter object for querying entries',
    },
    sorts: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'JSON array of sort objects (e.g. [{"attribute":"created_at","direction":"desc"}])',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of entries to return (default 500)',
    },
    offset: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of entries to skip for pagination',
    },
  },

  request: {
    url: (params) => `https://api.attio.com/v2/lists/${params.list}/entries/query`,
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, unknown> = {}
      if (params.filter) {
        try {
          body.filter =
            typeof params.filter === 'string' ? JSON.parse(params.filter) : params.filter
        } catch {
          body.filter = {}
        }
      }
      if (params.sorts) {
        try {
          body.sorts = typeof params.sorts === 'string' ? JSON.parse(params.sorts) : params.sorts
        } catch {
          body.sorts = []
        }
      }
      if (params.limit !== undefined) body.limit = params.limit
      if (params.offset !== undefined) body.offset = params.offset
      return body
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!response.ok) {
      logger.error('Attio API request failed', { data, status: response.status })
      throw new Error(data.message || 'Failed to query list entries')
    }
    const entries = (data.data ?? []).map((entry: Record<string, unknown>) => {
      const id = entry.id as { list_id?: string; entry_id?: string } | undefined
      return {
        entryId: id?.entry_id ?? null,
        listId: id?.list_id ?? null,
        parentRecordId: (entry.parent_record_id as string) ?? null,
        parentObject: (entry.parent_object as string) ?? null,
        createdAt: (entry.created_at as string) ?? null,
        entryValues: (entry.entry_values as Record<string, unknown>) ?? {},
      }
    })
    return {
      success: true,
      output: {
        entries,
        count: entries.length,
      },
    }
  },

  outputs: {
    entries: {
      type: 'array',
      description: 'Array of list entries',
      items: {
        type: 'object',
        properties: LIST_ENTRY_OUTPUT_PROPERTIES,
      },
    },
    count: { type: 'number', description: 'Number of entries returned' },
  },
}
