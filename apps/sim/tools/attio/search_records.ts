import { createLogger } from '@sim/logger'
import type { AttioSearchRecordsParams, AttioSearchRecordsResponse } from '@/tools/attio/types'
import { METADATA_OUTPUT, RECORDS_ARRAY_OUTPUT } from '@/tools/attio/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('AttioSearchRecords')

export const attioSearchRecordsTool: ToolConfig<
  AttioSearchRecordsParams,
  AttioSearchRecordsResponse
> = {
  id: 'attio_search_records',
  name: 'Search Records in Attio',
  description:
    'Perform a fuzzy search across Attio records. Searches names, domains, emails, phone numbers, and social handles for people and companies.',
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
      description: 'The access token for the Attio API',
    },
    query: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'The search query string to match against records (names, domains, emails, phone numbers, social handles)',
    },
    objects: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Array of object slugs to search within (e.g., ["people", "companies"]). If not provided, searches all objects.',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of records to return (default: 25)',
    },
  },

  request: {
    url: () => 'https://api.attio.com/v2/objects/records/search',
    method: 'POST',
    headers: (params) => {
      if (!params.accessToken) {
        throw new Error('Access token is required')
      }

      return {
        Authorization: `Bearer ${params.accessToken}`,
        'Content-Type': 'application/json',
      }
    },
    body: (params) => {
      const body: Record<string, any> = {
        query: params.query,
      }

      if (params.objects) {
        let parsedObjects = params.objects
        if (typeof params.objects === 'string') {
          try {
            parsedObjects = JSON.parse(params.objects)
          } catch {
            parsedObjects = (params.objects as string).split(',').map((o) => o.trim())
          }
        }
        if (Array.isArray(parsedObjects) && parsedObjects.length > 0) {
          body.objects = parsedObjects
        }
      }

      if (params.limit !== undefined) {
        body.limit = Number(params.limit)
      }

      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      logger.error('Attio API request failed', { data, status: response.status })
      throw new Error(data.message || data.error || 'Failed to search records in Attio')
    }

    const records = data.data || []

    return {
      success: true,
      output: {
        records,
        total: data.total,
        metadata: {
          totalReturned: records.length,
          hasMore: records.length === (data.limit || 25),
        },
        success: true,
      },
    }
  },

  outputs: {
    records: RECORDS_ARRAY_OUTPUT,
    total: { type: 'number', description: 'Total number of matching records', optional: true },
    metadata: METADATA_OUTPUT,
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
