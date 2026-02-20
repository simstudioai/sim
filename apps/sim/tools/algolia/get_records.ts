import type { AlgoliaGetRecordsParams, AlgoliaGetRecordsResponse } from '@/tools/algolia/types'
import type { ToolConfig } from '@/tools/types'

export const getRecordsTool: ToolConfig<AlgoliaGetRecordsParams, AlgoliaGetRecordsResponse> = {
  id: 'algolia_get_records',
  name: 'Algolia Get Records',
  description: 'Retrieve multiple records by objectID from one or more Algolia indices',
  version: '1.0',

  params: {
    applicationId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Algolia Application ID',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Algolia API Key',
    },
    indexName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Default index name for all requests',
    },
    requests: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Array of objects specifying records to retrieve. Each must have "objectID" and optionally "indexName" and "attributesToRetrieve".',
    },
  },

  request: {
    url: (params) => `https://${params.applicationId}-dsn.algolia.net/1/indexes/*/objects`,
    method: 'POST',
    headers: (params) => ({
      'x-algolia-application-id': params.applicationId,
      'x-algolia-api-key': params.apiKey,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const parsed =
        typeof params.requests === 'string' ? JSON.parse(params.requests) : params.requests
      const requests = (parsed as Record<string, unknown>[]).map((req) => ({
        ...req,
        indexName: req.indexName ?? params.indexName,
      }))
      return { requests }
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        results: data.results ?? [],
      },
    }
  },

  outputs: {
    results: {
      type: 'array',
      description: 'Array of retrieved records (null entries for records not found)',
      items: {
        type: 'object',
        description:
          'A record object containing objectID and user-defined attributes, or null if not found',
        properties: {
          objectID: {
            type: 'string',
            description: 'Unique identifier of the record',
          },
        },
      },
    },
  },
}
