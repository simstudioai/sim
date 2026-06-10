import type { DubBulkCreateLinksParams, DubBulkCreateLinksResponse } from '@/tools/dub/types'
import type { ToolConfig } from '@/tools/types'

export const bulkCreateLinksTool: ToolConfig<DubBulkCreateLinksParams, DubBulkCreateLinksResponse> =
  {
    id: 'dub_bulk_create_links',
    name: 'Dub Bulk Create Links',
    description:
      'Create up to 100 short links in a single request. Returns the created links alongside any per-link errors.',
    version: '1.0.0',

    params: {
      apiKey: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'Dub API key',
      },
      links: {
        type: 'json',
        required: true,
        visibility: 'user-or-llm',
        description:
          'JSON array of link objects to create. Each object requires a "url" and may include domain, key, tagIds, and other link fields (max 100).',
      },
    },

    request: {
      url: 'https://api.dub.co/links/bulk',
      method: 'POST',
      headers: (params) => ({
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.apiKey}`,
      }),
      body: (params) => {
        const links = typeof params.links === 'string' ? JSON.parse(params.links) : params.links
        return Array.isArray(links) ? links : [links]
      },
    },

    transformResponse: async (response: Response) => {
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error?.message || data.error || 'Failed to bulk create links')
      }

      const results = Array.isArray(data) ? (data as Record<string, unknown>[]) : []
      const created = results.filter((item) => !item.error)
      const errors = results.filter((item) => item.error)

      return {
        success: true,
        output: {
          created,
          errors,
          count: created.length,
        },
      }
    },

    outputs: {
      created: {
        type: 'json',
        description: 'Array of successfully created link objects',
      },
      errors: {
        type: 'json',
        description: 'Array of per-link errors ({ link, error, code }) for links that failed',
      },
      count: { type: 'number', description: 'Number of links successfully created' },
    },
  }
