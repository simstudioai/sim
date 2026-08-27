import type { QdrantResponse, QdrantUpsertParams } from '@/tools/qdrant/types'
import {
  QDRANT_RESPONSE_OUTPUT_PROPERTIES,
  UPSERT_RESULT_OUTPUT_PROPERTIES,
} from '@/tools/qdrant/types'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

/**
 * Renders a non-ok Qdrant envelope status as a user-facing reason. The status is
 * either the literal `"ok"` or an `{ error: string }` object.
 */
function qdrantStatusError(status: unknown): string {
  if (typeof status === 'string') {
    return `Qdrant upsert returned status "${status}"`
  }
  if (status && typeof status === 'object' && 'error' in status) {
    return `Qdrant upsert failed: ${String((status as { error: unknown }).error)}`
  }
  return 'Qdrant upsert failed with an unknown status'
}

export const upsertPointsTool: ToolConfig<QdrantUpsertParams, QdrantResponse> = {
  id: 'qdrant_upsert_points',
  name: 'Qdrant Upsert Points',
  description: 'Insert or update points in a Qdrant collection',
  version: '1.0',

  params: {
    url: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Qdrant instance URL (e.g., https://your-cluster.qdrant.io)',
    },
    apiKey: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Qdrant API key for authentication',
    },
    collection: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Collection name for upsert (e.g., "my_collection")',
    },
    points: {
      type: 'array',
      required: true,
      visibility: 'user-only',
      description: 'Array of points to upsert',
    },
  },

  request: {
    method: 'PUT',
    url: (params) =>
      `${params.url.replace(/\/$/, '')}/collections/${safeUrlPathSegment(params.collection, 'collection')}/points`,
    headers: (params) => ({
      'Content-Type': 'application/json',
      ...(params.apiKey ? { 'api-key': params.apiKey } : {}),
    }),
    body: (params) => ({ points: params.points }),
  },

  /**
   * Only reached for a 2xx response: both execution paths throw on a non-ok
   * response before `transformResponse` runs, so Qdrant's own `status` field is
   * the sole success signal here.
   */
  transformResponse: async (response) => {
    const data = await response.json()
    const succeeded = data.status === 'ok'
    return {
      success: succeeded,
      output: {
        status: data.status,
        data: data.result,
      },
      ...(succeeded ? {} : { error: qdrantStatusError(data.status) }),
    }
  },

  outputs: {
    status: QDRANT_RESPONSE_OUTPUT_PROPERTIES.status,
    data: {
      type: 'object',
      description: 'Result data from the upsert operation',
      properties: UPSERT_RESULT_OUTPUT_PROPERTIES,
    },
  },
}
