import type { AlgoliaDeleteIndexParams, AlgoliaDeleteIndexResponse } from '@/tools/algolia/types'
import type { ToolConfig } from '@/tools/types'

export const deleteIndexTool: ToolConfig<AlgoliaDeleteIndexParams, AlgoliaDeleteIndexResponse> = {
  id: 'algolia_delete_index',
  name: 'Algolia Delete Index',
  description: 'Delete an entire Algolia index and all its records',
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
      description: 'Algolia Admin API Key (must have deleteIndex ACL)',
    },
    indexName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name of the Algolia index to delete',
    },
  },

  request: {
    method: 'DELETE',
    url: (params) =>
      `https://${params.applicationId}.algolia.net/1/indexes/${encodeURIComponent(params.indexName)}`,
    headers: (params) => ({
      'x-algolia-application-id': params.applicationId,
      'x-algolia-api-key': params.apiKey,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        taskID: data.taskID ?? 0,
        deletedAt: data.deletedAt ?? null,
      },
    }
  },

  outputs: {
    taskID: {
      type: 'number',
      description: 'Algolia task ID for tracking the index deletion',
    },
    deletedAt: {
      type: 'string',
      description: 'Timestamp when the index was deleted',
      optional: true,
    },
  },
}
