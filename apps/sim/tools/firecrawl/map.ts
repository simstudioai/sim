import { firecrawlHosting } from '@/tools/firecrawl/hosting'
import type { MapLink, MapParams, MapResponse } from '@/tools/firecrawl/types'
import { MAP_LINK_OUTPUT_PROPERTIES } from '@/tools/firecrawl/types'
import type { ToolConfig } from '@/tools/types'

/**
 * Keeps an explicit `0` rather than letting a truthy check drop it into Firecrawl's default —
 * the official SDK guards its own map payload with `!= null` for the same reason. A blank
 * short-input still arrives as `''` and stays omitted.
 * @see https://github.com/firecrawl/firecrawl/blob/main/apps/js-sdk/firecrawl/src/v2/methods/map.ts
 */
function resolveMapTimeout(value: number | string | undefined): number | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value === 'string' && value.trim() === '') return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

/**
 * `/v2/map` normally returns link objects, but the official SDK still accepts a bare URL string
 * per entry and widens it to `{ url }`. Mirroring that keeps the declared object shape true for
 * every payload Firecrawl can send.
 * @see https://github.com/firecrawl/firecrawl/blob/main/apps/js-sdk/firecrawl/src/v2/methods/map.ts
 */
function normalizeMapLinks(links: unknown): MapLink[] {
  if (!Array.isArray(links)) return []
  return links.flatMap((link): MapLink[] => {
    if (typeof link === 'string') return [{ url: link }]
    if (link && typeof link === 'object' && typeof (link as MapLink).url === 'string') {
      return [link as MapLink]
    }
    return []
  })
}

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
      description: 'The base URL to map and discover links from (e.g., "https://example.com")',
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
      visibility: 'user-or-llm',
      description:
        'Maximum number of links to return (e.g., 100, 1000, 5000). Max: 100,000, default: 5,000',
    },
    mapTimeout: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description:
        "Firecrawl's own map deadline in milliseconds, sent as the request body's `timeout`. Named `mapTimeout` because a tool param called `timeout` is consumed as the outbound fetch deadline instead of reaching Firecrawl.",
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

  hosting: firecrawlHosting(),

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

      if (params.search) body.search = params.search
      if (params.sitemap) body.sitemap = params.sitemap
      if (typeof params.includeSubdomains === 'boolean')
        body.includeSubdomains = params.includeSubdomains
      if (typeof params.ignoreQueryParameters === 'boolean')
        body.ignoreQueryParameters = params.ignoreQueryParameters
      if (params.limit) body.limit = Number(params.limit)
      const mapTimeout = resolveMapTimeout(params.mapTimeout)
      if (mapTimeout !== undefined) body.timeout = mapTimeout
      if (params.location) body.location = params.location

      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    return {
      success: data.success,
      output: {
        success: data.success,
        links: normalizeMapLinks(data.links),
        creditsUsed: 1,
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
      description:
        'Discovered pages. Each entry is an object with the URL plus, when Firecrawl has them, the page title and description.',
      items: {
        type: 'object',
        properties: MAP_LINK_OUTPUT_PROPERTIES,
      },
    },
  },
}
