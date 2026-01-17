import type { DatasetParams, DatasetResponse } from '@/tools/brightdata/types'
import type { ToolConfig } from '@/tools/types'

/**
 * Bright Data Google Maps Reviews dataset tool.
 */
export const datasetGoogleMapsReviewsTool: ToolConfig<DatasetParams, DatasetResponse> = {
  id: 'brightdata_dataset_google_maps_reviews',
  name: 'Bright Data Google Maps Reviews Dataset',
  description:
    'Quickly read structured Google maps reviews data.\nRequires a valid Google maps URL.\nThis can be a cache lookup, so it can be more reliable than scraping',
  version: '1.0.0',

  params: {
    url: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Dataset input URL',
    },
    days_limit: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Days limit (default: 3)',
    },
    apiToken: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Bright Data API token',
    },
  },

  request: {
    method: 'POST',
    url: '/api/tools/brightdata/dataset',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, unknown> = {
        datasetId: 'gd_luzfs1dn2oa0teb81',
        apiToken: params.apiToken,
        url: params.url,
        days_limit: params.days_limit,
      }

      if (body.days_limit === undefined) {
        body.days_limit = '3'
      }

      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Bright Data dataset fetch failed')
    }

    return {
      success: true,
      output: data,
    }
  },

  outputs: {
    data: {
      type: 'object',
      description: 'Structured dataset response',
    },
    snapshot_at: {
      type: 'string',
      description: 'Timestamp of data snapshot',
      optional: true,
    },
  },
}
