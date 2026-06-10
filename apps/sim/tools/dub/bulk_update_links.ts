import type { DubBulkUpdateLinksParams, DubBulkUpdateLinksResponse } from '@/tools/dub/types'
import type { ToolConfig } from '@/tools/types'

export const bulkUpdateLinksTool: ToolConfig<DubBulkUpdateLinksParams, DubBulkUpdateLinksResponse> =
  {
    id: 'dub_bulk_update_links',
    name: 'Dub Bulk Update Links',
    description:
      'Apply the same set of field updates to up to 100 links at once, selected by link IDs or external IDs.',
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
        required: false,
        visibility: 'user-or-llm',
        description:
          'Comma-separated link IDs to update (max 100, takes precedence over externalIds)',
      },
      externalIds: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Comma-separated external IDs to update (max 100)',
      },
      data: {
        type: 'json',
        required: true,
        visibility: 'user-or-llm',
        description:
          'JSON object of fields to apply to every selected link (e.g. { "archived": true, "tagIds": ["..."] })',
      },
    },

    request: {
      url: 'https://api.dub.co/links/bulk',
      method: 'PATCH',
      headers: (params) => ({
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.apiKey}`,
      }),
      body: (params) => {
        const data = typeof params.data === 'string' ? JSON.parse(params.data) : params.data
        const linkIds = params.linkIds
          ? params.linkIds
              .split(',')
              .map((id) => id.trim())
              .filter(Boolean)
          : []
        const externalIds = params.externalIds
          ? params.externalIds
              .split(',')
              .map((id) => id.trim())
              .filter(Boolean)
          : []
        if (linkIds.length === 0 && externalIds.length === 0) {
          throw new Error(
            'Bulk Update Links requires at least one Link ID or External ID to select which links to update.'
          )
        }
        const body: Record<string, unknown> = { data: data ?? {} }
        if (linkIds.length > 0) {
          body.linkIds = linkIds
        } else {
          body.externalIds = externalIds
        }
        return body
      },
    },

    transformResponse: async (response: Response) => {
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error?.message || data.error || 'Failed to bulk update links')
      }

      const updated = Array.isArray(data) ? (data as Record<string, unknown>[]) : []

      return {
        success: true,
        output: {
          updated,
          count: updated.length,
        },
      }
    },

    outputs: {
      updated: {
        type: 'json',
        description: 'Array of updated link objects',
      },
      count: { type: 'number', description: 'Number of links updated' },
    },
  }
