import type { MapParams, MapResponse } from '@/tools/firecrawl/types'
import type { ToolConfig } from '@/tools/types'

export const mapTool: ToolConfig<MapParams, MapResponse> = {
  id: 'firecrawl_map',
  name: 'Firecrawl Map',
  description:
    'Get a complete list of URLs from any website quickly and reliably. Useful for discovering all pages on a site without crawling them.',
  version: '1.0.0',

  params: {
    url: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The base URL to map and discover links from',
    },
    search: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter results by relevance to a search term (e.g., "blog")',
    },
    sitemap: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Controls sitemap usage: "skip", "include" (default), or "only"',
    },
    includeSubdomains: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Whether to include URLs from subdomains (default: true)',
    },
    ignoreQueryParameters: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Exclude URLs containing query strings (default: true)',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Maximum number of links to return (max: 100,000, default: 5,000)',
    },
    timeout: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Request timeout in milliseconds',
    },
    location: {
      type: 'json',
      required: false,
      visibility: 'hidden',
      description: 'Geographic context for proxying (country, languages)',
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
    url: 'https://api.firecrawl.dev/v2/map',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    }),
    body: (params) => {
      const body: Record<string, any> = {
        url: params.url,
      }

      if (params.search != null) body.search = params.search
      if (params.sitemap != null) body.sitemap = params.sitemap
      if (params.includeSubdomains != null) body.includeSubdomains = params.includeSubdomains
      if (params.ignoreQueryParameters != null)
        body.ignoreQueryParameters = params.ignoreQueryParameters
      if (params.limit !== undefined) body.limit = Number(params.limit)
      if (params.timeout !== undefined) body.timeout = Number(params.timeout)
      if (params.location !== undefined) body.location = params.location

      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    return {
      success: data.success,
      output: {
        success: data.success,
        links: data.links || [],
      },
    }
  },

  outputs: {
    success: {
      type: 'boolean',
      description: 'Whether the mapping operation was successful',
    },
    links: {
      type: 'array',
      description: 'Array of discovered URLs from the website',
      items: {
        type: 'string',
      },
    },
  },
}
