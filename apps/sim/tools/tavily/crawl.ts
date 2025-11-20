import type { CrawlResponse, TavilyCrawlParams } from '@/tools/tavily/types'
import type { ToolConfig } from '@/tools/types'

export const crawlTool: ToolConfig<TavilyCrawlParams, CrawlResponse> = {
  id: 'tavily_crawl',
  name: 'Tavily Crawl',
  description:
    "Systematically crawl and extract content from websites using Tavily's crawl API. Supports depth control, path filtering, domain restrictions, and natural language instructions for targeted crawling.",
  version: '1.0.0',

  params: {
    url: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The root URL to begin the crawl',
    },
    instructions: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Natural language directions for the crawler (costs 2 credits per 10 pages)',
    },
    max_depth: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'How far from base URL to explore (1-5, default: 1)',
    },
    max_breadth: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Links followed per page level (≥1, default: 20)',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Total links processed before stopping (≥1, default: 50)',
    },
    select_paths: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Comma-separated regex patterns to include specific URL paths (e.g., /docs/.*)',
    },
    select_domains: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Comma-separated regex patterns to restrict crawling to certain domains',
    },
    exclude_paths: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Comma-separated regex patterns to skip specific URL paths',
    },
    exclude_domains: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Comma-separated regex patterns to block certain domains',
    },
    allow_external: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Include external domain links in results (default: true)',
    },
    include_images: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Incorporate images in crawl output',
    },
    extract_depth: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Extraction depth: basic (1 credit/5 pages) or advanced (2 credits/5 pages)',
    },
    format: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Output format: markdown or text (default: markdown)',
    },
    include_favicon: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Add favicon URL for each result',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Tavily API Key',
    },
  },

  request: {
    url: 'https://api.tavily.com/crawl',
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, any> = {
        url: params.url,
      }

      if (params.instructions) body.instructions = params.instructions
      if (params.max_depth) body.max_depth = Number(params.max_depth)
      if (params.max_breadth) body.max_breadth = Number(params.max_breadth)
      if (params.limit) body.limit = Number(params.limit)
      if (params.select_paths) {
        body.select_paths = params.select_paths.split(',').map((p) => p.trim())
      }
      if (params.select_domains) {
        body.select_domains = params.select_domains.split(',').map((d) => d.trim())
      }
      if (params.exclude_paths) {
        body.exclude_paths = params.exclude_paths.split(',').map((p) => p.trim())
      }
      if (params.exclude_domains) {
        body.exclude_domains = params.exclude_domains.split(',').map((d) => d.trim())
      }
      if (params.allow_external !== undefined) body.allow_external = params.allow_external
      if (params.include_images !== undefined) body.include_images = params.include_images
      if (params.extract_depth) body.extract_depth = params.extract_depth
      if (params.format) body.format = params.format
      if (params.include_favicon !== undefined) body.include_favicon = params.include_favicon

      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    return {
      success: true,
      output: {
        base_url: data.base_url,
        results: data.results || [],
        response_time: data.response_time,
        ...(data.request_id && { request_id: data.request_id }),
      },
    }
  },

  outputs: {
    base_url: { type: 'string', description: 'The base URL that was crawled' },
    results: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'The crawled page URL' },
          raw_content: { type: 'string', description: 'Extracted content from the page' },
          favicon: { type: 'string', description: 'Favicon URL (if requested)' },
        },
      },
      description: 'Array of crawled pages with extracted content',
    },
    response_time: { type: 'number', description: 'Time taken for the crawl request in seconds' },
    request_id: { type: 'string', description: 'Unique identifier for support reference' },
  },
}
