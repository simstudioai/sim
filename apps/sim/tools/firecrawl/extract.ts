import { createLogger } from '@sim/logger'
import { DEFAULT_EXECUTION_TIMEOUT_MS } from '@/lib/core/execution-limits'
import type { ExtractParams, ExtractResponse } from '@/tools/firecrawl/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('FirecrawlExtractTool')

const POLL_INTERVAL_MS = 5000
const MAX_POLL_TIME_MS = DEFAULT_EXECUTION_TIMEOUT_MS

export const extractTool: ToolConfig<ExtractParams, ExtractResponse> = {
  id: 'firecrawl_extract',
  name: 'Firecrawl Extract',
  description:
    'Extract structured data from entire webpages using natural language prompts and JSON schema. Powerful agentic feature for intelligent data extraction.',
  version: '1.0.0',

  params: {
    urls: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Array of URLs to extract data from (e.g., ["https://example.com/page1", "https://example.com/page2"] or ["https://example.com/*"])',
    },
    prompt: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Natural language guidance for the extraction process',
    },
    schema: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'JSON Schema defining the structure of data to extract',
    },
    enableWebSearch: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Enable web search to find supplementary information (default: false)',
    },
    ignoreSitemap: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Ignore sitemap.xml files during scanning (default: false)',
    },
    includeSubdomains: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Extend scanning to subdomains (default: true)',
    },
    showSources: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Return data sources in the response (default: false)',
    },
    ignoreInvalidURLs: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Skip invalid URLs in the array (default: true)',
    },
    scrapeOptions: {
      type: 'json',
      required: false,
      visibility: 'hidden',
      description: 'Advanced scraping configuration options',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Firecrawl API key',
    },
  },

  request: {
    method: 'POST',
    url: 'https://api.firecrawl.dev/v2/extract',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    }),
    body: (params) => {
      const body: Record<string, any> = {
        urls: params.urls,
      }

      if (params.prompt) body.prompt = params.prompt
      if (params.schema) body.schema = params.schema
      if (typeof params.enableWebSearch === 'boolean') body.enableWebSearch = params.enableWebSearch
      if (typeof params.ignoreSitemap === 'boolean') body.ignoreSitemap = params.ignoreSitemap
      if (typeof params.includeSubdomains === 'boolean')
        body.includeSubdomains = params.includeSubdomains
      if (typeof params.showSources === 'boolean') body.showSources = params.showSources
      if (typeof params.ignoreInvalidURLs === 'boolean')
        body.ignoreInvalidURLs = params.ignoreInvalidURLs

      if (params.scrapeOptions != null) {
        const cleanedScrapeOptions = Object.entries(params.scrapeOptions).reduce(
          (acc, [key, val]) => {
            if (val != null) {
              acc[key] = val
            }
            return acc
          },
          {} as Record<string, any>
        )
        if (Object.keys(cleanedScrapeOptions).length > 0) {
          body.scrapeOptions = cleanedScrapeOptions
        }
      }

      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    return {
      success: true,
      output: {
        jobId: data.id,
        success: false,
        data: {},
      },
    }
  },
  postProcess: async (result, params) => {
    if (!result.success) {
      return result
    }

    const jobId = result.output.jobId
    logger.info(`Firecrawl extract job ${jobId} created, polling for completion...`)

    let elapsedTime = 0

    while (elapsedTime < MAX_POLL_TIME_MS) {
      try {
        const statusResponse = await fetch(`https://api.firecrawl.dev/v2/extract/${jobId}`, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${params.apiKey}`,
            'Content-Type': 'application/json',
          },
        })

        if (!statusResponse.ok) {
          throw new Error(`Failed to get extract status: ${statusResponse.statusText}`)
        }

        const extractData = await statusResponse.json()
        logger.info(`Firecrawl extract job ${jobId} status: ${extractData.status}`)

        if (extractData.status === 'completed') {
          result.output = {
            jobId,
            success: true,
            data: extractData.data || {},
          }
          return result
        }

        if (extractData.status === 'failed') {
          return {
            ...result,
            success: false,
            error: `Extract job failed: ${extractData.error || 'Unknown error'}`,
          }
        }

        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
        elapsedTime += POLL_INTERVAL_MS
      } catch (error: any) {
        logger.error('Error polling for extract job status:', {
          message: error.message || 'Unknown error',
          jobId,
        })

        return {
          ...result,
          success: false,
          error: `Error polling for extract job status: ${error.message || 'Unknown error'}`,
        }
      }
    }

    logger.warn(
      `Extract job ${jobId} did not complete within the maximum polling time (${MAX_POLL_TIME_MS / 1000}s)`
    )
    return {
      ...result,
      success: false,
      error: `Extract job did not complete within the maximum polling time (${MAX_POLL_TIME_MS / 1000}s)`,
    }
  },

  outputs: {
    success: {
      type: 'boolean',
      description: 'Whether the extraction operation was successful',
    },
    data: {
      type: 'object',
      description: 'Extracted structured data according to the schema or prompt',
    },
  },
}
