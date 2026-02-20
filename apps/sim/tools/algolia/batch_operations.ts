import type {
  AlgoliaBatchOperationsParams,
  AlgoliaBatchOperationsResponse,
} from '@/tools/algolia/types'
import type { ToolConfig } from '@/tools/types'

export const batchOperationsTool: ToolConfig<
  AlgoliaBatchOperationsParams,
  AlgoliaBatchOperationsResponse
> = {
  id: 'algolia_batch_operations',
  name: 'Algolia Batch Operations',
  description:
    'Perform batch add, update, partial update, or delete operations on records in an Algolia index',
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
      description: 'Algolia Admin API Key',
    },
    indexName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name of the Algolia index',
    },
    requests: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Array of batch operations. Each item has "action" (addObject, updateObject, partialUpdateObject, partialUpdateObjectNoCreate, deleteObject) and "body" (the record data, must include objectID for update/delete)',
    },
  },

  request: {
    url: (params) =>
      `https://${params.applicationId}.algolia.net/1/indexes/${encodeURIComponent(params.indexName)}/batch`,
    method: 'POST',
    headers: (params) => ({
      'x-algolia-application-id': params.applicationId,
      'x-algolia-api-key': params.apiKey,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const requests =
        typeof params.requests === 'string' ? JSON.parse(params.requests) : params.requests
      return { requests }
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        taskID: data.taskID ?? 0,
        objectIDs: data.objectIDs ?? [],
      },
    }
  },

  outputs: {
    taskID: {
      type: 'number',
      description: 'Algolia task ID for tracking the batch operation',
    },
    objectIDs: {
      type: 'array',
      description: 'Array of object IDs affected by the batch operation',
      items: {
        type: 'string',
        description: 'Unique identifier of an affected record',
      },
    },
  },
}
