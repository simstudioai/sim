import type { GetDatasetItemsParams, GetDatasetItemsResult } from '@/tools/apify/types'
import type { ToolConfig } from '@/tools/types'

export const apifyGetDatasetItemsTool: ToolConfig<GetDatasetItemsParams, GetDatasetItemsResult> = {
  id: 'apify_get_dataset_items',
  name: 'APIFY Get Dataset Items',
  description: 'Retrieve items stored in an APIFY dataset',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'APIFY API token from console.apify.com/account#/integrations',
    },
    datasetId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Dataset ID to read items from. Example: "9RnD3Pql2vGZkc5H5"',
    },
    itemLimit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Max items to return (1-250000). Default: all items. Example: 500',
    },
    offset: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of items to skip at the start. Default: 0',
    },
    fields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated list of fields to include. Example: "title,url,price"',
    },
  },

  request: {
    url: (params) => {
      const encodedDatasetId = encodeURIComponent(params.datasetId.trim())
      const baseUrl = `https://api.apify.com/v2/datasets/${encodedDatasetId}/items`
      const queryParams = new URLSearchParams()

      queryParams.set('clean', 'true')
      if (params.itemLimit) {
        const limit = Math.max(1, Math.min(params.itemLimit, 250000))
        queryParams.set('limit', limit.toString())
      }
      if (params.offset != null) {
        queryParams.set('offset', params.offset.toString())
      }
      if (params.fields) {
        queryParams.set('fields', params.fields)
      }

      return `${baseUrl}?${queryParams.toString()}`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
    }),
  },

  transformResponse: async (response, params) => {
    if (!response.ok) {
      const errorText = await response.text()
      return {
        success: false,
        output: { success: false, datasetId: params?.datasetId ?? '', items: [], count: 0 },
        error: `APIFY API error: ${errorText}`,
      }
    }

    const items = await response.json()
    const list = Array.isArray(items) ? items : []
    return {
      success: true,
      output: {
        success: true,
        datasetId: params?.datasetId ?? '',
        items: list,
        count: list.length,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the items were retrieved' },
    datasetId: { type: 'string', description: 'Dataset ID the items were read from' },
    items: { type: 'array', description: 'Items stored in the dataset' },
    count: { type: 'number', description: 'Number of items returned' },
  },
}
