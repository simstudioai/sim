import type {
  BrightDataSyncScrapeParams,
  BrightDataSyncScrapeResponse,
} from '@/tools/brightdata/types'
import type { ToolConfig } from '@/tools/types'

export const brightDataSyncScrapeTool: ToolConfig<
  BrightDataSyncScrapeParams,
  BrightDataSyncScrapeResponse
> = {
  id: 'brightdata_sync_scrape',
  name: 'Bright Data Sync Scrape',
  description:
    'Scrape URLs synchronously using a Bright Data pre-built scraper and get structured results directly. Supports up to 20 URLs with a 1-minute timeout.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Bright Data API token',
    },
    datasetId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Dataset scraper ID from your Bright Data dashboard (e.g., "gd_l1viktl72bvl7bjuj0")',
    },
    urls: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'JSON array of URL objects to scrape, up to 20 (e.g., [{"url": "https://example.com/product"}])',
    },
    format: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Output format: "json", "ndjson", or "csv". Defaults to "json"',
    },
    includeErrors: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to include error reports in results',
    },
  },

  request: {
    method: 'POST',
    url: (params) => {
      const queryParams = new URLSearchParams()
      queryParams.set('dataset_id', params.datasetId)
      queryParams.set('format', params.format || 'json')
      if (params.includeErrors) queryParams.set('include_errors', 'true')
      return `https://api.brightdata.com/datasets/v3/scrape?${queryParams.toString()}`
    },
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    }),
    body: (params) => {
      if (typeof params.urls === 'string') {
        try {
          const parsed = JSON.parse(params.urls)
          return { input: Array.isArray(parsed) ? parsed : [parsed] }
        } catch {
          return { input: [{ url: params.urls }] }
        }
      }
      return { input: params.urls }
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(errorText || `Sync scrape failed with status ${response.status}`)
    }

    if (response.status === 202) {
      const data = await response.json()
      return {
        success: true,
        output: {
          data: [],
          snapshotId: data.snapshot_id ?? null,
          isAsync: true,
        },
      }
    }

    const data = await response.json()
    const results = Array.isArray(data) ? data : [data]

    return {
      success: true,
      output: {
        data: results,
        snapshotId: null,
        isAsync: false,
      },
    }
  },

  outputs: {
    data: {
      type: 'array',
      description:
        'Array of scraped result objects with fields specific to the dataset scraper used',
      items: {
        type: 'json',
        description: 'A scraped record with dataset-specific fields',
      },
    },
    snapshotId: {
      type: 'string',
      description:
        'Snapshot ID returned if the request exceeded the 1-minute timeout and switched to async processing',
      optional: true,
    },
    isAsync: {
      type: 'boolean',
      description:
        'Whether the request fell back to async mode (true means use snapshot ID to retrieve results)',
    },
  },
}
