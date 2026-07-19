import type {
  AlgoliaGetTaskStatusParams,
  AlgoliaGetTaskStatusResponse,
} from '@/tools/algolia/types'
import type { ToolConfig } from '@/tools/types'

export const getTaskStatusTool: ToolConfig<
  AlgoliaGetTaskStatusParams,
  AlgoliaGetTaskStatusResponse
> = {
  id: 'algolia_get_task_status',
  name: 'Algolia Get Task Status',
  description: 'Check whether an Algolia indexing task has finished publishing',
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
      description: 'Name of the Algolia index the task ran against',
    },
    taskID: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'The taskID returned by a previous write operation',
    },
  },

  request: {
    method: 'GET',
    url: (params) =>
      `https://${params.applicationId}-dsn.algolia.net/1/indexes/${encodeURIComponent(params.indexName.trim())}/task/${encodeURIComponent(String(params.taskID).trim())}`,
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
        status: data.status ?? '',
      },
    }
  },

  outputs: {
    status: {
      type: 'string',
      description:
        'Task status: "published" once the operation has been applied, "notPublished" while still pending',
    },
  },
}
