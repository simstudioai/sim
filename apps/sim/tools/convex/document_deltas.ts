import type {
  ConvexDocumentDeltasApiResponse,
  ConvexDocumentDeltasParams,
  ConvexDocumentDeltasResponse,
} from '@/tools/convex/types'
import { convexApiUrl, convexAuthHeaders, parseConvexResponse } from '@/tools/convex/utils'
import type { ToolConfig } from '@/tools/types'

export const documentDeltasTool: ToolConfig<
  ConvexDocumentDeltasParams,
  ConvexDocumentDeltasResponse
> = {
  id: 'convex_document_deltas',
  name: 'Convex Document Deltas',
  description:
    'List documents that changed after a snapshot or previous delta cursor. Deleted documents are returned with a _deleted flag. Requires streaming export, available on Convex paid plans.',
  version: '1.0.0',

  params: {
    deploymentUrl: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Convex deployment URL (e.g., https://your-deployment.convex.cloud)',
    },
    deployKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Convex deploy key from the dashboard Settings page',
    },
    cursor: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Timestamp cursor to read deltas after. Use the snapshot value from List Documents or the cursor from a previous Document Deltas page.',
    },
    tableName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Table to read deltas from. Omit to read deltas from all tables.',
    },
  },

  request: {
    url: (params) => {
      const cursor = String(params.cursor ?? '').trim()
      if (!cursor) {
        throw new Error(
          'Cursor is required: pass the snapshot value from List Documents or the cursor from a previous Document Deltas page'
        )
      }
      const query = new URLSearchParams({ format: 'json', cursor })
      if (params.tableName?.trim()) query.set('tableName', params.tableName.trim())
      return convexApiUrl(params.deploymentUrl, `/api/document_deltas?${query.toString()}`)
    },
    method: 'GET',
    headers: (params) => convexAuthHeaders(params.deployKey),
  },

  transformResponse: async (response: Response) => {
    const data = (await parseConvexResponse(response)) as ConvexDocumentDeltasApiResponse

    return {
      success: true,
      output: {
        documents: data.values ?? [],
        hasMore: data.hasMore ?? false,
        cursor: data.cursor !== undefined && data.cursor !== null ? String(data.cursor) : null,
      },
    }
  },

  outputs: {
    documents: {
      type: 'array',
      description: 'Changed documents, each including _table and _ts fields',
      items: { type: 'object' },
    },
    hasMore: {
      type: 'boolean',
      description: 'Whether more delta pages remain',
    },
    cursor: {
      type: 'string',
      description: 'Cursor to pass back in when fetching the next page of deltas',
      optional: true,
    },
  },
}
