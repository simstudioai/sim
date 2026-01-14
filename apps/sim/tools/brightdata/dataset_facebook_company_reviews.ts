import type { DatasetParams, DatasetResponse } from '@/tools/brightdata/types'
import type { ToolConfig } from '@/tools/types'

/**
 * Bright Data Facebook Company Reviews dataset tool.
 */
export const datasetFacebookCompanyReviewsTool: ToolConfig<DatasetParams, DatasetResponse> = {
  id: 'brightdata_dataset_facebook_company_reviews',
  name: 'Bright Data Facebook Company Reviews Dataset',
  description: "Quickly read structured Facebook company reviews data.\nRequires a valid Facebook company URL and number of reviews.\nThis can be a cache lookup, so it can be more reliable than scraping",
  version: '1.0.0',

  params: {
    url: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Dataset input URL',
    },
    num_of_reviews: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Number of reviews to fetch',
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
        datasetId: 'gd_m0dtqpiu1mbcyc2g86',
        apiToken: params.apiToken,
        url: params.url,
        num_of_reviews: params.num_of_reviews,
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
