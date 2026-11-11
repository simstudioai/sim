import { createLogger } from '@sim/logger'
import { sleep } from '@sim/utils/helpers'
import { escapeRegExp } from '@sim/utils/string'
import { DEFAULT_EXECUTION_TIMEOUT_MS } from '@/lib/core/execution-limits'
import { firecrawlHosting } from '@/tools/firecrawl/hosting'
import {
  applyFirecrawlFormatModelInput,
  applyFirecrawlScrapeOptionsModelInput,
  selectFirecrawlFormatModelInput,
  selectFirecrawlScrapeOptionsModelInput,
} from '@/tools/firecrawl/model-input'
import type { FirecrawlCrawlParams, FirecrawlCrawlResponse } from '@/tools/firecrawl/types'
import { CRAWLED_PAGE_OUTPUT_PROPERTIES } from '@/tools/firecrawl/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('FirecrawlCrawlTool')

const POLL_INTERVAL_MS = 5000
const MAX_POLL_TIME_MS = DEFAULT_EXECUTION_TIMEOUT_MS

/**
 * Path segments of a URL as Firecrawl v1 counted them: index files add no depth. A URL without
 * a scheme is read as https, as Firecrawl reads it.
 */
function urlPathDepth(url: string): number {
  const absolute = /^[a-z][a-z\d+.-]*:\/\//i.test(url) ? url : `https://${url}`
  if (!URL.canParse(absolute)) return 0
  return new URL(absolute).pathname
    .split('/')
    .filter((segment) => segment !== '' && segment !== 'index.html' && segment !== 'index.php')
    .length
}

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
      description:
        'The website URL to crawl (e.g., "https://example.com" or "https://docs.example.com/guide")',
    },
    limit: {
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
        'Maximum URL path depth below the starting URL (e.g., from /docs, 1 allows /docs/guide). Independent of link discovery depth',
    },
    formats: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Output formats for scraped content (e.g., ["markdown"], ["markdown", "html"], ["markdown", "links"])',
    },
    prompt: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: 'Natural-language crawl guidance supplied by existing configurations',
    },
    scrapeOptions: {
      type: 'json',
      required: false,
      visibility: 'hidden',
      description: 'Advanced scrape options supplied by existing configurations',
    },
    excludePaths: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'URL paths to exclude from crawling (e.g., ["/blog/*", "/admin/*", "/*.pdf"])',
    },
    includePaths: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'URL paths to include in crawling (e.g., ["/docs/*", "/api/*"]). Only these paths will be crawled',
    },
    onlyMainContent: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Extract only main content from pages',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Firecrawl API Key',
    },
  },

  hosting: firecrawlHosting(),

  request: {
    modelInput: {
      mode: 'project',
      select: (params) =>
        params.scrapeOptions
          ? {
              prompt: params.prompt,
              scrapeOptions: selectFirecrawlScrapeOptionsModelInput(params.scrapeOptions),
            }
          : {
              prompt: params.prompt,
              formats: selectFirecrawlFormatModelInput(params.formats),
            },
      applyProjected: (selectedParams, projectedSelection) => {
        if (Object.hasOwn(projectedSelection, 'scrapeOptions')) {
          return {
            prompt: projectedSelection.prompt,
            scrapeOptions: applyFirecrawlScrapeOptionsModelInput(
              selectedParams.scrapeOptions,
              projectedSelection.scrapeOptions
            ),
          }
        }
        return {
          prompt: projectedSelection.prompt,
          formats: applyFirecrawlFormatModelInput(
            selectedParams.formats,
            projectedSelection.formats
          ),
        }
      },
    },
    url: 'https://api.firecrawl.dev/v2/crawl',
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    }),
    body: (params) => {
      const body: Record<string, unknown> = {
        url: params.url,
        limit: Number(params.limit) || 100,
        scrapeOptions: params.scrapeOptions || {
          formats: params.formats || ['markdown'],
          onlyMainContent: params.onlyMainContent || false,
        },
      }

      if (params.prompt) body.prompt = params.prompt
      if (params.maxDiscoveryDepth != null && String(params.maxDiscoveryDepth).trim() !== '')
        body.maxDiscoveryDepth = Number(params.maxDiscoveryDepth)
      if (params.sitemap) body.sitemap = params.sitemap
      if (typeof params.crawlEntireDomain === 'boolean')
        body.crawlEntireDomain = params.crawlEntireDomain
      if (typeof params.allowExternalLinks === 'boolean')
        body.allowExternalLinks = params.allowExternalLinks
      if (typeof params.allowSubdomains === 'boolean') body.allowSubdomains = params.allowSubdomains
      if (typeof params.ignoreQueryParameters === 'boolean')
        body.ignoreQueryParameters = params.ignoreQueryParameters
      if (params.delay) body.delay = Number(params.delay)
      if (params.maxConcurrency) body.maxConcurrency = Number(params.maxConcurrency)
      if (params.excludePaths) body.excludePaths = params.excludePaths
      if (params.includePaths) body.includePaths = params.includePaths
      if (params.maxDepth != null && String(params.maxDepth).trim() !== '') {
        const requestedDepth = Number(params.maxDepth)
        if (!Number.isSafeInteger(requestedDepth) || requestedDepth < 0) {
          throw new Error('maxDepth must be a non-negative integer')
        }
        // v1 counted depth from the start URL, so the start page itself always passes the filter.
        const maxDepth = requestedDepth + urlPathDepth(params.url)

        // v1 depth counted URL path segments; v2 discovery depth counts link hops.
        body.regexOnFullURL = false
        if (params.includePaths?.length) {
          const indexFiles = ['index.html', 'index.php']
          const nonIndexSegmentPatterns = new Set<string>()
          // Rust regex has no lookarounds, so enumerate incomplete prefixes and first mismatches.
          for (const file of indexFiles) {
            for (let length = 0; length <= file.length; length++) {
              const prefix = file.slice(0, length)
              const nextCharacters = indexFiles
                .filter((indexFile) => indexFile.startsWith(prefix))
                .map((indexFile) => indexFile.charAt(length))
                .join('')
              const escapedPrefix = escapeRegExp(prefix)
              if (prefix && !indexFiles.includes(prefix)) {
                nonIndexSegmentPatterns.add(escapedPrefix)
              }
              nonIndexSegmentPatterns.add(`${escapedPrefix}[^/${nextCharacters}][^/]*`)
            }
          }
          const nonIndexBoundary = `^(/+[^/]+){${maxDepth}}/+(${[...nonIndexSegmentPatterns].join('|')})/*$`
          body.excludePaths = [
            ...(params.excludePaths ?? []),
            `^(/+[^/]+){${maxDepth + 2}}|${nonIndexBoundary}`,
          ]
        } else {
          body.includePaths = [
            `^(/+[^/]+){0,${maxDepth}}/*$`,
            `^(/+[^/]+){0,${maxDepth}}/+index\\.(html|php)/*$`,
          ]
        }
      }
      if (params.webhook) body.webhook = params.webhook
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
        const statusResponse = await fetch(`https://api.firecrawl.dev/v2/crawl/${jobId}`, {
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
        logger.info(`Firecrawl crawl job ${jobId} status: ${crawlData.status}`)

        if (crawlData.status === 'completed') {
          result.output = {
            pages: crawlData.data || [],
            total: crawlData.total || 0,
            // Forwarded as-is: defaulting a missing count to 0 would look like
            // a free crawl to the hosted-key pricing helper instead of the
            // metering failure it is.
            creditsUsed: crawlData.creditsUsed,
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
