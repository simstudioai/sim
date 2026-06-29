import { createLogger } from '@sim/logger'
import { sleep } from '@sim/utils/helpers'
import { DEFAULT_EXECUTION_TIMEOUT_MS } from '@/lib/core/execution-limits'
import type {
  FirecrawlBatchScrapeParams,
  FirecrawlBatchScrapeResponse,
} from '@/tools/firecrawl/types'
import { CRAWLED_PAGE_OUTPUT_PROPERTIES } from '@/tools/firecrawl/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('FirecrawlBatchScrapeTool')

const POLL_INTERVAL_MS = 5000
const MAX_POLL_TIME_MS = DEFAULT_EXECUTION_TIMEOUT_MS

/**
 * Normalizes a list of URLs supplied as an array, a JSON-string array, or a
 * newline-separated string into a trimmed string array.
 */
function normalizeUrls(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry).trim()).filter((entry) => entry.length > 0)
  }

  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed === '') return []
    try {
      const parsed = JSON.parse(trimmed)
      if (Array.isArray(parsed)) {
        return parsed.map((entry) => String(entry).trim()).filter((entry) => entry.length > 0)
      }
    } catch {
      // Fall through to newline-separated parsing
    }
    return trimmed
      .split(/\r?\n/)
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)
  }

  return []
}

export const batchScrapeTool: ToolConfig<FirecrawlBatchScrapeParams, FirecrawlBatchScrapeResponse> =
  {
    id: 'firecrawl_batch_scrape',
    name: 'Firecrawl Batch Scrape',
    description:
      'Scrape multiple URLs in a single batch job and retrieve structured content from each page.',
    version: '1.0.0',

    params: {
      urls: {
        type: 'json',
        required: true,
        visibility: 'user-or-llm',
        description:
          'Array of URLs to scrape (e.g., ["https://example.com/page1", "https://example.com/page2"])',
      },
      formats: {
        type: 'json',
        required: false,
        visibility: 'user-or-llm',
        description:
          'Output formats for scraped content (e.g., ["markdown"], ["markdown", "html"])',
      },
      onlyMainContent: {
        type: 'boolean',
        required: false,
        visibility: 'user-only',
        description: 'Extract only main content from pages',
      },
      maxConcurrency: {
        type: 'number',
        required: false,
        visibility: 'user-only',
        description: 'Maximum number of concurrent scrapes',
      },
      ignoreInvalidURLs: {
        type: 'boolean',
        required: false,
        visibility: 'user-only',
        description: 'Skip invalid URLs instead of failing the batch (default: true)',
      },
      scrapeOptions: {
        type: 'json',
        required: false,
        visibility: 'hidden',
        description: 'Advanced scraping configuration options',
      },
      zeroDataRetention: {
        type: 'boolean',
        required: false,
        visibility: 'user-only',
        description: 'Enable zero data retention',
      },
      apiKey: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'Firecrawl API key',
      },
    },

    hosting: {
      envKeyPrefix: 'FIRECRAWL_API_KEY',
      apiKeyParam: 'apiKey',
      byokProviderId: 'firecrawl',
      pricing: {
        type: 'custom',
        getCost: (_params, output) => {
          if (output.creditsUsed == null) {
            throw new Error('Firecrawl response missing creditsUsed field')
          }

          const creditsUsed = Number(output.creditsUsed)
          if (Number.isNaN(creditsUsed)) {
            throw new Error('Firecrawl response returned a non-numeric creditsUsed field')
          }

          return {
            cost: creditsUsed * 0.001,
            metadata: { creditsUsed },
          }
        },
      },
      rateLimit: {
        mode: 'per_request',
        requestsPerMinute: 100,
      },
    },

    request: {
      method: 'POST',
      url: 'https://api.firecrawl.dev/v2/batch/scrape',
      headers: (params) => ({
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.apiKey}`,
      }),
      body: (params) => {
        const body: Record<string, any> = {
          urls: normalizeUrls(params.urls),
        }

        const scrapeOptions: Record<string, any> = { ...(params.scrapeOptions ?? {}) }
        if (params.formats) scrapeOptions.formats = params.formats
        if (typeof params.onlyMainContent === 'boolean')
          scrapeOptions.onlyMainContent = params.onlyMainContent
        if (Object.keys(scrapeOptions).length > 0) {
          Object.assign(body, scrapeOptions)
        }

        if (params.maxConcurrency != null) body.maxConcurrency = Number(params.maxConcurrency)
        if (typeof params.ignoreInvalidURLs === 'boolean')
          body.ignoreInvalidURLs = params.ignoreInvalidURLs
        if (typeof params.zeroDataRetention === 'boolean')
          body.zeroDataRetention = params.zeroDataRetention

        return body
      },
    },

    transformResponse: async (response: Response) => {
      const data = await response.json()

      return {
        success: true,
        output: {
          jobId: data.id,
          invalidURLs: data.invalidURLs ?? [],
          pages: [],
          total: 0,
          completed: 0,
          creditsUsed: 0,
        },
      }
    },

    postProcess: async (result, params) => {
      if (!result.success) {
        return result
      }

      const jobId = result.output.jobId
      const invalidURLs = result.output.invalidURLs ?? []
      logger.info(`Firecrawl batch scrape job ${jobId} created, polling for completion...`)

      let elapsedTime = 0

      while (elapsedTime < MAX_POLL_TIME_MS) {
        try {
          const statusResponse = await fetch(`https://api.firecrawl.dev/v2/batch/scrape/${jobId}`, {
            method: 'GET',
            headers: {
              Authorization: `Bearer ${params.apiKey}`,
              'Content-Type': 'application/json',
            },
          })

          if (!statusResponse.ok) {
            throw new Error(`Failed to get batch scrape status: ${statusResponse.statusText}`)
          }

          const batchData = await statusResponse.json()
          logger.info(`Firecrawl batch scrape job ${jobId} status: ${batchData.status}`)

          if (batchData.status === 'completed') {
            result.output = {
              jobId,
              invalidURLs,
              pages: batchData.data ?? [],
              total: batchData.total ?? 0,
              completed: batchData.completed ?? 0,
              creditsUsed: batchData.creditsUsed ?? 0,
            }
            return result
          }

          if (batchData.status === 'failed') {
            return {
              ...result,
              success: false,
              error: `Batch scrape job failed: ${batchData.error || 'Unknown error'}`,
            }
          }

          await sleep(POLL_INTERVAL_MS)
          elapsedTime += POLL_INTERVAL_MS
        } catch (error: any) {
          logger.error('Error polling for batch scrape job status:', {
            message: error.message || 'Unknown error',
            jobId,
          })

          return {
            ...result,
            success: false,
            error: `Error polling for batch scrape job status: ${error.message || 'Unknown error'}`,
          }
        }
      }

      logger.warn(
        `Batch scrape job ${jobId} did not complete within the maximum polling time (${MAX_POLL_TIME_MS / 1000}s)`
      )
      return {
        ...result,
        success: false,
        error: `Batch scrape job did not complete within the maximum polling time (${MAX_POLL_TIME_MS / 1000}s)`,
      }
    },

    outputs: {
      pages: {
        type: 'array',
        description: 'Array of scraped pages with their content and metadata',
        items: {
          type: 'object',
          properties: CRAWLED_PAGE_OUTPUT_PROPERTIES,
        },
      },
      total: { type: 'number', description: 'Total number of pages attempted' },
      completed: { type: 'number', description: 'Number of pages successfully scraped' },
      invalidURLs: {
        type: 'array',
        description: 'URLs that were skipped because they were invalid',
        optional: true,
        items: { type: 'string', description: 'Invalid URL' },
      },
    },
  }
