import type { TavilySearchParams, TavilySearchResponse } from '@/tools/tavily/types'
import type { ToolConfig } from '@/tools/types'

export const searchTool: ToolConfig<TavilySearchParams, TavilySearchResponse> = {
  id: 'tavily_search',
  name: 'Tavily Search',
  description:
    "Perform AI-powered web searches using Tavily's search API. Returns structured results with titles, URLs, snippets, and optional raw content, optimized for relevance and accuracy.",
  version: '1.0.0',

  params: {
    query: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The search query to execute',
    },
    max_results: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Maximum number of results (1-20)',
    },
    topic: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Category type: general, news, or finance (default: general)',
    },
    search_depth: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Search scope: basic (1 credit) or advanced (2 credits) (default: basic)',
    },
    include_answer: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'LLM-generated response: true/basic for quick answer or advanced for detailed',
    },
    include_raw_content: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Parsed HTML content: true/markdown or text format',
    },
    include_images: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Include image search results',
    },
    include_image_descriptions: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Add descriptive text for images',
    },
    include_favicon: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Include favicon URLs',
    },
    chunks_per_source: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Maximum number of relevant chunks per source (1-3, default: 3)',
    },
    time_range: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Filter by recency: day/d, week/w, month/m, year/y',
    },
    start_date: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Earliest publication date (YYYY-MM-DD format)',
    },
    end_date: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Latest publication date (YYYY-MM-DD format)',
    },
    include_domains: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Comma-separated list of domains to whitelist (max 300)',
    },
    exclude_domains: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Comma-separated list of domains to blacklist (max 150)',
    },
    country: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Boost results from specified country (general topic only)',
    },
    auto_parameters: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Automatic parameter configuration based on query intent',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Tavily API Key',
    },
  },

  request: {
    url: 'https://api.tavily.com/search',
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, any> = {
        query: params.query,
      }

      // Only include optional parameters if explicitly set
      if (params.max_results) body.max_results = Number(params.max_results)
      if (params.topic) body.topic = params.topic
      if (params.search_depth) body.search_depth = params.search_depth

      // Handle include_answer: only include if not empty and not "false"
      if (
        params.include_answer &&
        params.include_answer !== 'false' &&
        params.include_answer !== ''
      ) {
        // Accept "basic" or "advanced" as strings, convert "true" to boolean
        body.include_answer = params.include_answer === 'true' ? true : params.include_answer
      }

      // Handle include_raw_content: only include if not empty and not "false"
      if (
        params.include_raw_content &&
        params.include_raw_content !== 'false' &&
        params.include_raw_content !== ''
      ) {
        // Accept "markdown" or "text" as strings, convert "true" to boolean
        body.include_raw_content =
          params.include_raw_content === 'true' ? true : params.include_raw_content
      }

      if (params.include_images !== undefined) body.include_images = params.include_images
      if (params.include_image_descriptions !== undefined)
        body.include_image_descriptions = params.include_image_descriptions
      if (params.include_favicon !== undefined) body.include_favicon = params.include_favicon
      if (params.chunks_per_source) body.chunks_per_source = Number(params.chunks_per_source)
      if (params.time_range) body.time_range = params.time_range
      if (params.start_date) body.start_date = params.start_date
      if (params.end_date) body.end_date = params.end_date
      if (params.include_domains) {
        body.include_domains = params.include_domains.split(',').map((d) => d.trim())
      }
      if (params.exclude_domains) {
        body.exclude_domains = params.exclude_domains.split(',').map((d) => d.trim())
      }
      if (params.country) body.country = params.country
      if (params.auto_parameters !== undefined) body.auto_parameters = params.auto_parameters

      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    return {
      success: true,
      output: {
        query: data.query,
        results: data.results.map((result: any) => ({
          title: result.title,
          url: result.url,
          snippet: result.snippet,
          ...(result.score !== undefined && { score: result.score }),
          ...(result.raw_content && { raw_content: result.raw_content }),
          ...(result.favicon && { favicon: result.favicon }),
        })),
        ...(data.answer && { answer: data.answer }),
        ...(data.images && { images: data.images }),
        ...(data.auto_parameters && { auto_parameters: data.auto_parameters }),
        response_time: data.response_time,
      },
    }
  },

  outputs: {
    query: { type: 'string', description: 'The search query that was executed' },
    results: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          url: { type: 'string' },
          snippet: { type: 'string' },
          score: { type: 'number' },
          raw_content: { type: 'string' },
          favicon: { type: 'string' },
        },
      },
      description: 'Search results with titles, URLs, content snippets, and optional metadata',
    },
    answer: { type: 'string', description: 'LLM-generated answer to the query (if requested)' },
    images: {
      type: 'array',
      items: { type: 'string' },
      description: 'Query-related images (if requested)',
    },
    auto_parameters: {
      type: 'object',
      description: 'Automatically selected parameters based on query intent (if enabled)',
    },
    response_time: { type: 'number', description: 'Time taken for the search request in seconds' },
  },
}
