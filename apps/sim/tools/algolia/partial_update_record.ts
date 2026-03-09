import type {
  AlgoliaPartialUpdateRecordParams,
  AlgoliaPartialUpdateRecordResponse,
} from '@/tools/algolia/types'
import type { ToolConfig } from '@/tools/types'

export const partialUpdateRecordTool: ToolConfig<
  AlgoliaPartialUpdateRecordParams,
  AlgoliaPartialUpdateRecordResponse
> = {
  id: 'algolia_partial_update_record',
  name: 'Algolia Partial Update Record',
  description: 'Partially update a record in an Algolia index without replacing it entirely',
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
    objectID: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The objectID of the record to update',
    },
    attributes: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'JSON object with attributes to update. Supports built-in operations like {"stock": {"_operation": "Decrement", "value": 1}}',
    },
    createIfNotExists: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to create the record if it does not exist (default: true)',
    },
  },

  request: {
    url: (params) => {
      const base = `https://${params.applicationId}.algolia.net/1/indexes/${encodeURIComponent(params.indexName)}/${encodeURIComponent(params.objectID)}/partial`
      if (params.createIfNotExists === false) {
        return `${base}?createIfNotExists=false`
      }
      return base
    },
    method: 'POST',
    headers: (params) => ({
      'x-algolia-application-id': params.applicationId,
      'x-algolia-api-key': params.apiKey,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const attributes =
        typeof params.attributes === 'string' ? JSON.parse(params.attributes) : params.attributes
      return attributes
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        taskID: data.taskID ?? 0,
        objectID: data.objectID ?? '',
        updatedAt: data.updatedAt ?? null,
      },
    }
  },

  outputs: {
    taskID: {
      type: 'number',
      description: 'Algolia task ID for tracking the update operation',
    },
    objectID: {
      type: 'string',
      description: 'The objectID of the updated record',
    },
    updatedAt: {
      type: 'string',
      description: 'Timestamp when the record was updated',
    },
  },
}
