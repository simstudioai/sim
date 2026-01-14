import type { DatasetParams, DatasetResponse } from '@/tools/brightdata/types'
import type { ToolConfig } from '@/tools/types'

/**
 * Bright Data Yahoo Finance Business dataset tool.
 */
export const datasetYahooFinanceBusinessTool: ToolConfig<DatasetParams, DatasetResponse> = {
  id: 'brightdata_dataset_yahoo_finance_business',
  name: 'Bright Data Yahoo Finance Business Dataset',
  description: "Quickly read structured yahoo finance business data.\nRequires a valid yahoo finance business URL.\nThis can be a cache lookup, so it can be more reliable than scraping",
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
        datasetId: 'gd_lmrpz3vxmz972ghd7',
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
