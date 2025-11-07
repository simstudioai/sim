import { createLogger } from '@/lib/logs/console/logger'
import type { FirecrawlCrawlParams, FirecrawlCrawlResponse } from '@/tools/firecrawl/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('FirecrawlCrawlTool')

const POLL_INTERVAL_MS = 5000 // 5 seconds between polls
const MAX_POLL_TIME_MS = 300000 // 5 minutes maximum polling time

export const crawlTool: ToolConfig<FirecrawlCrawlParams, FirecrawlCrawlResponse> = {
  id: 'firecrawl_crawl',
  name: 'Firecrawl Crawl',
  description: 'Crawl entire websites and extract structured content from all accessible pages',
  version: '1.0.0',
  params: {
    url: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The website URL to crawl',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Maximum number of pages to crawl (default: 100)',
    },
    onlyMainContent: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Extract only main content from pages',
    },
    prompt: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Natural language instruction to auto-generate crawler options',
    },
    maxDiscoveryDepth: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Depth limit for URL discovery (root pages have depth 0)',
    },
    sitemap: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Whether to use sitemap data: "skip" or "include" (default: "include")',
    },
    crawlEntireDomain: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Follow sibling/parent URLs or only child paths (default: false)',
    },
    allowExternalLinks: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Follow external website links (default: false)',
    },
    allowSubdomains: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Follow subdomain links (default: false)',
    },
    ignoreQueryParameters: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Prevent re-scraping same path with different query params (default: false)',
    },
    delay: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Seconds between scrapes for rate limit compliance',
    },
    maxConcurrency: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Concurrent scrape limit',
    },
    excludePaths: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Array of regex patterns for URLs to exclude',
    },
    includePaths: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Array of regex patterns for URLs to include exclusively',
    },
    webhook: {
      type: 'json',
      required: false,
      visibility: 'hidden',
      description: 'Webhook configuration for crawl notifications',
    },
    scrapeOptions: {
      type: 'json',
      required: false,
      visibility: 'hidden',
      description: 'Advanced scraping configuration',
    },
    zeroDataRetention: {
      type: 'boolean',
      required: false,
      visibility: 'hidden',
      description: 'Enable zero data retention (default: false)',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Firecrawl API Key',
    },
  },
  request: {
    url: 'https://api.firecrawl.dev/v1/crawl',
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    }),
    body: (params) => {
      const body: Record<string, any> = {
        url: params.url,
        limit: Number(params.limit) || 100,
        scrapeOptions: params.scrapeOptions || {
          formats: ['markdown'],
          onlyMainContent: params.onlyMainContent || false,
        },
      }

      // Add all optional crawl-specific parameters if provided
      if (params.prompt !== undefined) body.prompt = params.prompt
      if (params.maxDiscoveryDepth !== undefined)
        body.maxDiscoveryDepth = Number(params.maxDiscoveryDepth)
      if (params.sitemap !== undefined) body.sitemap = params.sitemap
      if (params.crawlEntireDomain !== undefined) body.crawlEntireDomain = params.crawlEntireDomain
      if (params.allowExternalLinks !== undefined)
        body.allowExternalLinks = params.allowExternalLinks
      if (params.allowSubdomains !== undefined) body.allowSubdomains = params.allowSubdomains
      if (params.ignoreQueryParameters !== undefined)
        body.ignoreQueryParameters = params.ignoreQueryParameters
      if (params.delay !== undefined) body.delay = Number(params.delay)
      if (params.maxConcurrency !== undefined) body.maxConcurrency = Number(params.maxConcurrency)
      if (params.excludePaths !== undefined) body.excludePaths = params.excludePaths
      if (params.includePaths !== undefined) body.includePaths = params.includePaths
      if (params.webhook !== undefined) body.webhook = params.webhook
      if (params.zeroDataRetention !== undefined) body.zeroDataRetention = params.zeroDataRetention

      return body
    },
  },
  transformResponse: async (response: Response) => {
    const data = await response.json()

    return {
      success: true,
      output: {
        jobId: data.jobId || data.id,
        pages: [],
        total: 0,
        creditsUsed: 0,
      },
    }
  },
  postProcess: async (result, params) => {
    if (!result.success) {
      return result
    }

    const jobId = result.output.jobId
    logger.info(`Firecrawl crawl job ${jobId} created, polling for completion...`)

    let elapsedTime = 0

    while (elapsedTime < MAX_POLL_TIME_MS) {
      try {
        const statusResponse = await fetch(`/api/tools/firecrawl/crawl/${jobId}`, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${params.apiKey}`,
          },
        })

        if (!statusResponse.ok) {
          throw new Error(`Failed to get crawl status: ${statusResponse.statusText}`)
        }

        const crawlData = await statusResponse.json()
        logger.info(`Firecrawl crawl job ${jobId} status: ${crawlData.status}`)

        if (crawlData.status === 'completed') {
          result.output = {
            pages: crawlData.data || [],
            total: crawlData.total || 0,
            creditsUsed: crawlData.creditsUsed || 0,
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

        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
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
        properties: {
          markdown: { type: 'string', description: 'Page content in markdown format' },
          html: { type: 'string', description: 'Page HTML content' },
          metadata: {
            type: 'object',
            description: 'Page metadata',
            properties: {
              title: { type: 'string', description: 'Page title' },
              description: { type: 'string', description: 'Page description' },
              language: { type: 'string', description: 'Page language' },
              sourceURL: { type: 'string', description: 'Source URL of the page' },
              statusCode: { type: 'number', description: 'HTTP status code' },
            },
          },
        },
      },
    },
    total: { type: 'number', description: 'Total number of pages found during crawl' },
    creditsUsed: {
      type: 'number',
      description: 'Number of credits consumed by the crawl operation',
    },
  },
}
