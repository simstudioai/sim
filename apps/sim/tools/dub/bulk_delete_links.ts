import type { DubBulkDeleteLinksParams, DubBulkDeleteLinksResponse } from '@/tools/dub/types'
import type { ToolConfig } from '@/tools/types'

export const bulkDeleteLinksTool: ToolConfig<DubBulkDeleteLinksParams, DubBulkDeleteLinksResponse> =
  {
    id: 'dub_bulk_delete_links',
    name: 'Dub Bulk Delete Links',
    description:
      'Delete up to 100 short links in a single request by their link IDs. Non-existing IDs are ignored.',
    version: '1.0.0',

    params: {
      apiKey: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'Dub API key',
      },
      linkIds: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Comma-separated link IDs to delete (max 100)',
      },
    },

    request: {
      url: (params) => {
        const url = new URL('https://api.dub.co/links/bulk')
        const ids = params.linkIds
          .split(',')
          .map((id) => id.trim())
          .filter(Boolean)
        url.searchParams.set('linkIds', ids.join(','))
        return url.toString()
      },
      method: 'DELETE',
      headers: (params) => ({
        Accept: 'application/json',
        Authorization: `Bearer ${params.apiKey}`,
      }),
    },

    transformResponse: async (response: Response) => {
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error?.message || data.error || 'Failed to bulk delete links')
      }

      return {
        success: true,
        output: {
          deletedCount: data.deletedCount ?? 0,
        },
      }
    },

    outputs: {
      deletedCount: { type: 'number', description: 'Number of links that were deleted' },
    },
  }
