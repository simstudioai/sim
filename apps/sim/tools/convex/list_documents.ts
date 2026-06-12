import type {
  ConvexListDocumentsParams,
  ConvexListDocumentsResponse,
  ConvexListSnapshotApiResponse,
} from '@/tools/convex/types'
import { convexApiUrl, convexAuthHeaders, parseConvexResponse } from '@/tools/convex/utils'
import type { ToolConfig } from '@/tools/types'

export const listDocumentsTool: ToolConfig<ConvexListDocumentsParams, ConvexListDocumentsResponse> =
  {
    id: 'convex_list_documents',
    name: 'Convex List Documents',
    description:
      'List documents from a Convex table via a paginated snapshot. Pass the returned snapshot and page cursor back in to fetch the next page. Requires streaming export, available on Convex paid plans.',
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
      tableName: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Table to list documents from. Omit to list documents from all tables.',
      },
      snapshot: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description:
          'Snapshot timestamp from a previous page. Omit on the first request to start a new snapshot.',
      },
      pageCursor: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description:
          'Page cursor from a previous page of the same snapshot. Omit on the first request.',
      },
    },

    request: {
      url: (params) => {
        const query = new URLSearchParams({ format: 'json' })
        if (params.tableName?.trim()) query.set('tableName', params.tableName.trim())
        const snapshot = String(params.snapshot ?? '').trim()
        if (snapshot) query.set('snapshot', snapshot)
        const pageCursor = String(params.pageCursor ?? '').trim()
        if (pageCursor) query.set('cursor', pageCursor)
        return convexApiUrl(params.deploymentUrl, `/api/list_snapshot?${query.toString()}`)
      },
      method: 'GET',
      headers: (params) => convexAuthHeaders(params.deployKey),
    },

    transformResponse: async (response: Response) => {
      const data = (await parseConvexResponse(response)) as ConvexListSnapshotApiResponse

      return {
        success: true,
        output: {
          documents: data.values ?? [],
          hasMore: data.hasMore ?? false,
          snapshot:
            data.snapshot !== undefined && data.snapshot !== null ? String(data.snapshot) : null,
          pageCursor:
            data.cursor !== undefined && data.cursor !== null ? String(data.cursor) : null,
        },
      }
    },

    outputs: {
      documents: {
        type: 'array',
        description: 'Documents in this page of the snapshot',
        items: { type: 'object' },
      },
      hasMore: {
        type: 'boolean',
        description: 'Whether more pages remain in the snapshot',
      },
      snapshot: {
        type: 'string',
        description: 'Snapshot timestamp to pass back in when fetching the next page',
        optional: true,
      },
      pageCursor: {
        type: 'string',
        description: 'Page cursor to pass back in when fetching the next page',
        optional: true,
      },
    },
  }
