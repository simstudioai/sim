import type { MapResponse, TavilyMapParams } from '@/tools/tavily/types'
import type { ToolConfig } from '@/tools/types'

export const mapTool: ToolConfig<TavilyMapParams, MapResponse> = {
  id: 'tavily_map',
  name: 'Tavily Map',
  description:
    "Discover and visualize website structure using Tavily's map API. Maps out all accessible URLs from a base URL with depth control, path filtering, and domain restrictions.",
  version: '1.0.0',

  params: {
    url: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The root URL to begin mapping',
    },
    instructions: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Natural language guidance for mapping behavior (costs 2 credits per 10 pages)',
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
      description: 'Links to follow per level (default: 20)',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Total links to process (default: 50)',
    },
    select_paths: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Comma-separated regex patterns for URL path filtering (e.g., /docs/.*)',
    },
    select_domains: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Comma-separated regex patterns to restrict mapping to specific domains',
    },
    exclude_paths: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Comma-separated regex patterns to exclude specific URL paths',
    },
    exclude_domains: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Comma-separated regex patterns to exclude domains',
    },
    allow_external: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Include external domain links in results (default: true)',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Tavily API Key',
    },
  },

  request: {
    url: 'https://api.tavily.com/map',
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
    base_url: { type: 'string', description: 'The base URL that was mapped' },
    results: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Discovered URL' },
        },
      },
      description: 'Array of discovered URLs during mapping',
    },
    response_time: { type: 'number', description: 'Time taken for the map request in seconds' },
    request_id: { type: 'string', description: 'Unique identifier for support reference' },
  },
}
