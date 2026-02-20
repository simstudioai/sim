import type { AlgoliaGetRecordParams, AlgoliaGetRecordResponse } from '@/tools/algolia/types'
import type { ToolConfig } from '@/tools/types'

export const getRecordTool: ToolConfig<AlgoliaGetRecordParams, AlgoliaGetRecordResponse> = {
  id: 'algolia_get_record',
  name: 'Algolia Get Record',
  description: 'Get a record by objectID from an Algolia index',
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
      description: 'Name of the Algolia index',
    },
    objectID: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The objectID of the record to retrieve',
    },
    attributesToRetrieve: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated list of attributes to retrieve',
    },
  },

  request: {
    method: 'GET',
    url: (params) => {
      const base = `https://${params.applicationId}-dsn.algolia.net/1/indexes/${encodeURIComponent(params.indexName)}/${encodeURIComponent(params.objectID)}`
      if (params.attributesToRetrieve) {
        return `${base}?attributesToRetrieve=${encodeURIComponent(params.attributesToRetrieve)}`
      }
      return base
    },
    headers: (params) => ({
      'x-algolia-application-id': params.applicationId,
      'x-algolia-api-key': params.apiKey,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    const { objectID, ...rest } = data
    return {
      success: true,
      output: {
        objectID: objectID ?? '',
        record: rest,
      },
    }
  },

  outputs: {
    objectID: {
      type: 'string',
      description: 'The objectID of the retrieved record',
    },
    record: {
      type: 'object',
      description: 'The record data (all attributes)',
    },
  },
}
