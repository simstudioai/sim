import type { DatasetParams, DatasetResponse } from '@/tools/brightdata/types'
import type { ToolConfig } from '@/tools/types'

/**
 * Bright Data Youtube Comments dataset tool.
 */
export const datasetYoutubeCommentsTool: ToolConfig<DatasetParams, DatasetResponse> = {
  id: 'brightdata_dataset_youtube_comments',
  name: 'Bright Data Youtube Comments Dataset',
  description: "Quickly read structured youtube comments data.\nRequires a valid youtube video URL.\nThis can be a cache lookup, so it can be more reliable than scraping",
  version: '1.0.0',

  params: {
    url: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Dataset input URL',
    },
    num_of_comments: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of comments to fetch (default: 10)',
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
        datasetId: 'gd_lk9q0ew71spt1mxywf',
        apiToken: params.apiToken,
        url: params.url,
        num_of_comments: params.num_of_comments,
      }

      if (body.num_of_comments === undefined) {
        body.num_of_comments = '10'
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
