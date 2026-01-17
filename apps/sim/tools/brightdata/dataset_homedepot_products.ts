import type { DatasetParams, DatasetResponse } from '@/tools/brightdata/types'
import type { ToolConfig } from '@/tools/types'

/**
 * Bright Data Homedepot Products dataset tool.
 */
export const datasetHomedepotProductsTool: ToolConfig<DatasetParams, DatasetResponse> = {
  id: 'brightdata_dataset_homedepot_products',
  name: 'Bright Data Homedepot Products Dataset',
  description:
    'Quickly read structured homedepot product data.\nRequires a valid homedepot product URL.\nThis can be a cache lookup, so it can be more reliable than scraping',
  version: '1.0.0',

  params: {
    url: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Dataset input URL',
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
        datasetId: 'gd_lmusivh019i7g97q2n',
        apiToken: params.apiToken,
        url: params.url,
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
