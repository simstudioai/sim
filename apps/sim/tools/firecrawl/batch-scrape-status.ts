import type {
  FirecrawlBatchScrapeStatusParams,
  FirecrawlBatchScrapeStatusResponse,
} from '@/tools/firecrawl/types'
import { CRAWLED_PAGE_OUTPUT_PROPERTIES } from '@/tools/firecrawl/types'
import type { ToolConfig } from '@/tools/types'

export const batchScrapeStatusTool: ToolConfig<
  FirecrawlBatchScrapeStatusParams,
  FirecrawlBatchScrapeStatusResponse
> = {
  id: 'firecrawl_batch_scrape_status',
  name: 'Firecrawl Batch Scrape Status',
  description:
    'Check the status and retrieve results of a previously started Firecrawl batch scrape job by its job ID.',
  version: '1.0.0',

  params: {
    jobId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the batch scrape job to check',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Firecrawl API key',
    },
  },

  request: {
    method: 'GET',
    url: (params) =>
      `https://api.firecrawl.dev/v2/batch/scrape/${encodeURIComponent(params.jobId.trim())}`,
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    return {
      success: true,
      output: {
        status: data.status,
        total: data.total ?? 0,
        completed: data.completed ?? 0,
        creditsUsed: data.creditsUsed ?? 0,
        expiresAt: data.expiresAt ?? null,
        next: data.next ?? null,
        pages: data.data ?? [],
      },
    }
  },

  outputs: {
    status: {
      type: 'string',
      description: 'Current batch scrape status (scraping, completed, or failed)',
    },
    total: { type: 'number', description: 'Total number of pages attempted' },
    completed: { type: 'number', description: 'Number of pages successfully scraped' },
    creditsUsed: { type: 'number', description: 'Credits consumed by the batch scrape' },
    expiresAt: {
      type: 'string',
      description: 'ISO timestamp when the batch scrape results expire',
      optional: true,
    },
    next: {
      type: 'string',
      description: 'URL to retrieve the next page of results when present',
      optional: true,
    },
    pages: {
      type: 'array',
      description: 'Array of scraped pages with their content and metadata',
      items: {
        type: 'object',
        properties: CRAWLED_PAGE_OUTPUT_PROPERTIES,
      },
    },
  },
}
