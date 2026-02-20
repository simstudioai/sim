import type {
  AlgoliaCopyMoveIndexParams,
  AlgoliaCopyMoveIndexResponse,
} from '@/tools/algolia/types'
import type { ToolConfig } from '@/tools/types'

export const copyMoveIndexTool: ToolConfig<
  AlgoliaCopyMoveIndexParams,
  AlgoliaCopyMoveIndexResponse
> = {
  id: 'algolia_copy_move_index',
  name: 'Algolia Copy/Move Index',
  description: 'Copy or move an Algolia index to a new destination',
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
      description: 'Name of the source index',
    },
    operation: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Operation to perform: "copy" or "move"',
    },
    destination: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name of the destination index',
    },
    scope: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Array of scopes to copy (only for "copy" operation): ["settings", "synonyms", "rules"]. Omit to copy everything including records.',
    },
  },

  request: {
    url: (params) =>
      `https://${params.applicationId}.algolia.net/1/indexes/${encodeURIComponent(params.indexName)}/operation`,
    method: 'POST',
    headers: (params) => ({
      'x-algolia-application-id': params.applicationId,
      'x-algolia-api-key': params.apiKey,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, unknown> = {
        operation: params.operation,
        destination: params.destination,
      }
      if (params.scope) {
        const scope = typeof params.scope === 'string' ? JSON.parse(params.scope) : params.scope
        body.scope = scope
      }
      return body
    },
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
      description: 'Algolia task ID for tracking the copy/move operation',
    },
    updatedAt: {
      type: 'string',
      description: 'Timestamp when the operation was performed',
      optional: true,
    },
  },
}
