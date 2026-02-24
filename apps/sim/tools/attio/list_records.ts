import { createLogger } from '@sim/logger'
import type { AttioListRecordsParams, AttioListRecordsResponse } from '@/tools/attio/types'
import { METADATA_OUTPUT, PAGING_OUTPUT, RECORDS_ARRAY_OUTPUT } from '@/tools/attio/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('AttioListRecords')

export const attioListRecordsTool: ToolConfig<AttioListRecordsParams, AttioListRecordsResponse> = {
  id: 'attio_list_records',
  name: 'List Records in Attio',
  description:
    'List records from an Attio object (people, companies, or custom objects). Supports pagination via limit and offset.',
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
    object: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'The object type to list records from (e.g., "people", "companies", or a custom object slug)',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of records to return (default: 25, max: 500)',
    },
    offset: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of records to skip for pagination',
    },
    attributes: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Array of attribute slugs to include in the response. If not provided, all attributes are returned.',
    },
  },

  request: {
    url: (params) =>
      `https://api.attio.com/v2/objects/${encodeURIComponent(params.object)}/records/query`,
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
      const body: Record<string, any> = {}

      if (params.limit !== undefined) {
        body.limit = Number(params.limit)
      }

      if (params.offset !== undefined) {
        body.offset = Number(params.offset)
      }

      if (params.attributes && params.attributes.length > 0) {
        let parsedAttributes = params.attributes
        if (typeof params.attributes === 'string') {
          try {
            parsedAttributes = JSON.parse(params.attributes)
          } catch {
            parsedAttributes = (params.attributes as string).split(',').map((a) => a.trim())
          }
        }
        if (Array.isArray(parsedAttributes) && parsedAttributes.length > 0) {
          body.attributes = parsedAttributes
        }
      }

      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      logger.error('Attio API request failed', { data, status: response.status })
      throw new Error(data.message || data.error || 'Failed to list records from Attio')
    }

    const records = data.data || []
    const hasMore = records.length === (data.limit || 25)

    return {
      success: true,
      output: {
        records,
        paging: {
          offset: data.offset || 0,
          limit: data.limit || 25,
          total: data.total,
        },
        metadata: {
          totalReturned: records.length,
          hasMore,
        },
        success: true,
      },
    }
  },

  outputs: {
    records: RECORDS_ARRAY_OUTPUT,
    paging: PAGING_OUTPUT,
    metadata: METADATA_OUTPUT,
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
