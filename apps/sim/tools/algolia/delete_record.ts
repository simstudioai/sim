import type { AlgoliaDeleteRecordParams, AlgoliaDeleteRecordResponse } from '@/tools/algolia/types'
import type { ToolConfig } from '@/tools/types'

export const deleteRecordTool: ToolConfig<AlgoliaDeleteRecordParams, AlgoliaDeleteRecordResponse> =
  {
    id: 'algolia_delete_record',
    name: 'Algolia Delete Record',
    description: 'Delete a record by objectID from an Algolia index',
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
        description: 'The objectID of the record to delete',
      },
    },

    request: {
      method: 'DELETE',
      url: (params) =>
        `https://${params.applicationId}.algolia.net/1/indexes/${encodeURIComponent(params.indexName)}/${encodeURIComponent(params.objectID)}`,
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
        description: 'Algolia task ID for tracking the deletion',
      },
      deletedAt: {
        type: 'string',
        description: 'Timestamp when the record was deleted',
      },
    },
  }
