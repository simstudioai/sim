import type { DatasetParams, DatasetResponse } from '@/tools/brightdata/types'
import type { ToolConfig } from '@/tools/types'

/**
 * Bright Data Amazon product dataset tool.
 */
export const datasetAmazonProductTool: ToolConfig<DatasetParams, DatasetResponse> = {
  id: 'brightdata_dataset_amazon_product',
  name: 'Bright Data Amazon Product Dataset',
  description: 'Get structured Amazon product data from Bright Data dataset',
  version: '1.0.0',

  params: {
    url: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Amazon product URL (must contain /dp/)',
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
    body: (params) => ({
      datasetId: 'gd_l7q7dkf244hwjntr0',
      url: params.url,
      apiToken: params.apiToken,
    }),
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
      description: 'Structured Amazon product data',
    },
    snapshot_at: {
      type: 'string',
      description: 'Timestamp of data snapshot',
      optional: true,
    },
  },
}
