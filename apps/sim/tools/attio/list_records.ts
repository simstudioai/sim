import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import type { AttioListRecordsParams, AttioListRecordsResponse } from './types'
import { RECORDS_ARRAY_OUTPUT } from './types'

const logger = createLogger('AttioListRecords')

export const attioListRecordsTool: ToolConfig<AttioListRecordsParams, AttioListRecordsResponse> = {
  id: 'attio_list_records',
  name: 'Attio List Records',
  description: 'Query and list records for a given object type (e.g. people, companies)',
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
    objectType: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The object type slug (e.g. people, companies)',
    },
    filter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'JSON filter object for querying records',
    },
    sorts: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'JSON array of sort objects, e.g. [{"direction":"asc","attribute":"name"}]',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of records to return (default 500)',
    },
    offset: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of records to skip for pagination',
    },
  },

  request: {
    url: (params) => `https://api.attio.com/v2/objects/${params.objectType}/records/query`,
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, unknown> = {}
      if (params.filter) {
        try {
          body.filter = JSON.parse(params.filter)
        } catch {
          body.filter = params.filter
        }
      }
      if (params.sorts) {
        try {
          body.sorts = JSON.parse(params.sorts)
        } catch {
          body.sorts = params.sorts
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
      throw new Error(data.message || 'Failed to list records')
    }
    const records = data.data ?? []
    return {
      success: true,
      output: {
        records,
        count: records.length,
      },
    }
  },

  outputs: {
    records: RECORDS_ARRAY_OUTPUT,
    count: { type: 'number', description: 'Number of records returned' },
  },
}
