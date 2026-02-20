import type { AlgoliaAddRecordParams, AlgoliaAddRecordResponse } from '@/tools/algolia/types'
import type { ToolConfig } from '@/tools/types'

export const addRecordTool: ToolConfig<AlgoliaAddRecordParams, AlgoliaAddRecordResponse> = {
  id: 'algolia_add_record',
  name: 'Algolia Add Record',
  description: 'Add or replace a record in an Algolia index',
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
      required: false,
      visibility: 'user-or-llm',
      description: 'Object ID for the record (auto-generated if not provided)',
    },
    record: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description: 'JSON object representing the record to add',
    },
  },

  request: {
    url: (params) => {
      const base = `https://${params.applicationId}.algolia.net/1/indexes/${encodeURIComponent(params.indexName)}`
      if (params.objectID) {
        return `${base}/${encodeURIComponent(params.objectID)}`
      }
      return base
    },
    method: (params) => (params.objectID ? 'PUT' : 'POST'),
    headers: (params) => ({
      'x-algolia-application-id': params.applicationId,
      'x-algolia-api-key': params.apiKey,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const record = typeof params.record === 'string' ? JSON.parse(params.record) : params.record
      return record
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        taskID: data.taskID ?? 0,
        objectID: data.objectID ?? '',
        createdAt: data.createdAt ?? null,
        updatedAt: data.updatedAt ?? null,
      },
    }
  },

  outputs: {
    taskID: {
      type: 'number',
      description: 'Algolia task ID for tracking the indexing operation',
    },
    objectID: {
      type: 'string',
      description: 'The object ID of the added or replaced record',
    },
    createdAt: {
      type: 'string',
      description:
        'Timestamp when the record was created (only present when objectID is auto-generated)',
      optional: true,
    },
    updatedAt: {
      type: 'string',
      description:
        'Timestamp when the record was updated (only present when replacing an existing record)',
      optional: true,
    },
  },
}
