import { createLogger } from '@sim/logger'
import { sleep } from '@sim/utils/helpers'
import { DEFAULT_EXECUTION_TIMEOUT_MS } from '@/lib/core/execution-limits'
import { resolveCrwBaseUrl } from '@/tools/crw/base-url'
import type { CrwCrawlParams, CrwCrawlResponse } from '@/tools/crw/types'
import { CRAWLED_PAGE_OUTPUT_PROPERTIES } from '@/tools/crw/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('CrwCrawlTool')

const POLL_INTERVAL_MS = 5000
const MAX_POLL_TIME_MS = DEFAULT_EXECUTION_TIMEOUT_MS

export const crawlTool: ToolConfig<CrwCrawlParams, CrwCrawlResponse> = {
  id: 'crw_crawl',
  name: 'fastCRW Crawl',
  description: 'Crawl entire websites and extract structured content from all accessible pages',
  version: '1.0.0',
  params: {
    url: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'The website URL to crawl (e.g., "https://example.com" or "https://docs.example.com/guide")',
    },
    maxPages: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of pages to crawl (e.g., 50, 100, 500). Default: 100',
    },
    maxDepth: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Maximum depth to crawl from the starting URL (e.g., 1, 2, 3). Controls how many levels deep to follow links',
    },
    formats: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Output formats for scraped content (e.g., ["markdown"], ["markdown", "html"], ["markdown", "links"])',
    },
    onlyMainContent: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Extract only main content from pages',
    },
    baseUrl: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Base URL for self-hosted fastCRW (defaults to https://fastcrw.com/api)',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'fastCRW API key',
    },
  },

  hosting: {
    envKeyPrefix: 'CRW_API_KEY',
    apiKeyParam: 'apiKey',
    byokProviderId: 'crw',
    // fastCRW is BYOK-only — Sim does not meter usage.
    pricing: { type: 'per_request', cost: 0 },
    rateLimit: {
      mode: 'per_request',
      requestsPerMinute: 100,
    },
  },

  request: {
    url: (params) => `${resolveCrwBaseUrl(params.baseUrl)}/v1/crawl`,
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    }),
    body: (params) => {
      const body: Record<string, any> = {
        url: params.url,
        maxPages: Number(params.maxPages) || 100,
        scrapeOptions: params.scrapeOptions || {
          formats: params.formats || ['markdown'],
          onlyMainContent: params.onlyMainContent || false,
        },
      }

      if (params.maxDepth) body.maxDepth = Number(params.maxDepth)

      return body
    },
  },
  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (data.success === false || !data.id) {
      return {
        success: false,
        error: data.error || 'fastCRW crawl job creation failed',
        output: {
          pages: [],
          total: 0,
        },
      }
    }

    return {
      success: true,
      output: {
        jobId: data.id,
        pages: [],
        total: 0,
      },
    }
  },
  postProcess: async (result, params) => {
    if (!result.success) {
      return result
    }

    const jobId = result.output.jobId
    const baseUrl = resolveCrwBaseUrl(params.baseUrl)
    logger.info(`fastCRW crawl job ${jobId} created, polling for completion...`)

    let elapsedTime = 0

    while (elapsedTime < MAX_POLL_TIME_MS) {
      try {
        const statusResponse = await fetch(`${baseUrl}/v1/crawl/${jobId}`, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${params.apiKey}`,
            'Content-Type': 'application/json',
          },
        })

        if (!statusResponse.ok) {
          throw new Error(`Failed to get crawl status: ${statusResponse.statusText}`)
        }

        const crawlData = await statusResponse.json()
        logger.info(`fastCRW crawl job ${jobId} status: ${crawlData.status}`)

        if (crawlData.status === 'completed') {
          result.output = {
            pages: crawlData.data || [],
            total: crawlData.total || (crawlData.data || []).length,
          }
          return result
        }

        if (crawlData.status === 'failed') {
          return {
            ...result,
            success: false,
            error: `Crawl job failed: ${crawlData.error || 'Unknown error'}`,
          }
        }

        await sleep(POLL_INTERVAL_MS)
        elapsedTime += POLL_INTERVAL_MS
      } catch (error: any) {
        logger.error('Error polling for crawl job status:', {
          message: error.message || 'Unknown error',
          jobId,
        })

        return {
          ...result,
          success: false,
          error: `Error polling for crawl job status: ${error.message || 'Unknown error'}`,
        }
      }
    }

    logger.warn(
      `Crawl job ${jobId} did not complete within the maximum polling time (${MAX_POLL_TIME_MS / 1000}s)`
    )
    return {
      ...result,
      success: false,
      error: `Crawl job did not complete within the maximum polling time (${MAX_POLL_TIME_MS / 1000}s)`,
    }
  },

  outputs: {
    pages: {
      type: 'array',
      description: 'Array of crawled pages with their content and metadata',
      items: {
        type: 'object',
        properties: CRAWLED_PAGE_OUTPUT_PROPERTIES,
      },
    },
    total: { type: 'number', description: 'Total number of pages found during crawl' },
  },
}
