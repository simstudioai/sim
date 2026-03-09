import type { AlgoliaClearRecordsParams, AlgoliaClearRecordsResponse } from '@/tools/algolia/types'
import type { ToolConfig } from '@/tools/types'

export const clearRecordsTool: ToolConfig<AlgoliaClearRecordsParams, AlgoliaClearRecordsResponse> =
  {
    id: 'algolia_clear_records',
    name: 'Algolia Clear Records',
    description:
      'Clear all records from an Algolia index while keeping settings, synonyms, and rules',
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
        description: 'Name of the Algolia index to clear',
      },
    },

    request: {
      url: (params) =>
        `https://${params.applicationId}.algolia.net/1/indexes/${encodeURIComponent(params.indexName)}/clear`,
      method: 'POST',
      headers: (params) => ({
        'x-algolia-application-id': params.applicationId,
        'x-algolia-api-key': params.apiKey,
        'Content-Type': 'application/json',
      }),
    },

    transformResponse: async (response) => {
      const data = await response.json()
      return {
        success: true,
        output: {
          taskID: data.taskID ?? 0,
          updatedAt: data.updatedAt ?? null,
        },
      }
    },

    outputs: {
      taskID: {
        type: 'number',
        description: 'Algolia task ID for tracking the clear operation',
      },
      updatedAt: {
        type: 'string',
        description: 'Timestamp when the records were cleared',
        optional: true,
      },
    },
  }
