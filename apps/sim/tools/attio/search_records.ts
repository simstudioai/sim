import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import type { AttioSearchRecordsParams, AttioSearchRecordsResponse } from './types'

const logger = createLogger('AttioSearchRecords')

export const attioSearchRecordsTool: ToolConfig<
  AttioSearchRecordsParams,
  AttioSearchRecordsResponse
> = {
  id: 'attio_search_records',
  name: 'Attio Search Records',
  description: 'Fuzzy search for records across object types in Attio',
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
    query: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The search query (max 256 characters)',
    },
    objects: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Comma-separated object slugs to search (e.g. people,companies)',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of results (1-25, default 25)',
    },
  },

  request: {
    url: 'https://api.attio.com/v2/objects/records/search',
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const objects = params.objects
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
      return {
        query: params.query,
        objects,
        limit: params.limit ?? 25,
        request_as: { type: 'workspace' },
      }
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!response.ok) {
      logger.error('Attio API request failed', { data, status: response.status })
      throw new Error(data.message || 'Failed to search records')
    }
    const results = (data.data ?? []).map(
      (item: {
        id?: { workspace_id?: string; object_id?: string; record_id?: string }
        object_slug?: string
        record_text?: string
        record_image?: string
      }) => ({
        recordId: item.id?.record_id ?? null,
        objectId: item.id?.object_id ?? null,
        objectSlug: item.object_slug ?? null,
        recordText: item.record_text ?? null,
        recordImage: item.record_image ?? null,
      })
    )
    return {
      success: true,
      output: {
        results,
        count: results.length,
      },
    }
  },

  outputs: {
    results: {
      type: 'array',
      description: 'Search results',
      items: {
        type: 'object',
        properties: {
          recordId: { type: 'string', description: 'The record ID' },
          objectId: { type: 'string', description: 'The object type ID' },
          objectSlug: { type: 'string', description: 'The object type slug' },
          recordText: { type: 'string', description: 'Display text for the record' },
          recordImage: { type: 'string', description: 'Image URL for the record', optional: true },
        },
      },
    },
    count: { type: 'number', description: 'Number of results returned' },
  },
}
