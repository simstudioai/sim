import type {
  BrightDataScrapeDatasetParams,
  BrightDataScrapeDatasetResponse,
} from '@/tools/brightdata/types'
import type { ToolConfig } from '@/tools/types'

export const brightDataScrapeDatasetTool: ToolConfig<
  BrightDataScrapeDatasetParams,
  BrightDataScrapeDatasetResponse
> = {
  id: 'brightdata_scrape_dataset',
  name: 'Bright Data Scrape Dataset',
  description:
    'Trigger a Bright Data pre-built scraper to extract structured data from URLs. Supports 660+ scrapers for platforms like Amazon, LinkedIn, Instagram, and more.',
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
        'JSON array of URL objects to scrape (e.g., [{"url": "https://example.com/product"}])',
    },
    format: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Output format: "json" or "csv". Defaults to "json"',
    },
  },

  request: {
    method: 'POST',
    url: (params) => {
      const queryParams = new URLSearchParams()
      queryParams.set('dataset_id', params.datasetId)
      queryParams.set('format', params.format || 'json')
      return `https://api.brightdata.com/datasets/v3/trigger?${queryParams.toString()}`
    },
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    }),
    body: (params) => {
      if (typeof params.urls === 'string') {
        try {
          return JSON.parse(params.urls)
        } catch {
          return [{ url: params.urls }]
        }
      }
      return params.urls
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(errorText || `Dataset trigger failed with status ${response.status}`)
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        snapshotId: data.snapshot_id ?? data.snapshotId ?? '',
        status: data.status ?? 'triggered',
      },
    }
  },

  outputs: {
    snapshotId: {
      type: 'string',
      description: 'The snapshot ID to retrieve results later',
    },
    status: {
      type: 'string',
      description: 'Status of the scraping job (e.g., "triggered", "running")',
    },
  },
}
