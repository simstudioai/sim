import type { ToolConfig } from '@/tools/types'
import type { YouSearchParams, YouSearchResponse } from '@/tools/you/types'

export const searchTool: ToolConfig<YouSearchParams, YouSearchResponse> = {
  id: 'you_search',
  name: 'You.com Search',
  description:
    'Search the web with You.com. Returns LLM-ready web and news results with titles, URLs, descriptions, and query-relevant snippets.',
  version: '1.0.0',

  hosting: {
    envKeyPrefix: 'YOU_API_KEY',
    apiKeyParam: 'apiKey',
    byokProviderId: 'you',
    pricing: {
      type: 'custom',
      getCost: (_params, output) => {
        // You.com Search: $5/1k calls, livecrawl adds $1/1k crawled pages
        // https://you.com/pricing
        const countCrawled = (section: unknown): number =>
          Array.isArray(section) ? section.filter((result) => result?.contents != null).length : 0
        const crawledPages = countCrawled(output.web) + countCrawled(output.news)
        const cost = 0.005 + crawledPages * 0.001
        return { cost, metadata: { crawledPages } }
      },
    },
    rateLimit: {
      mode: 'per_request',
      requestsPerMinute: 60,
    },
  },

  params: {
    query: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'The search query. Supports operators: site:domain.com, filetype:pdf, +term, -term, AND/OR/NOT, lang:en',
    },
    count: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Maximum number of results per section (1-100, default: 10)',
    },
    offset: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Pagination offset (0-9, default: 0)',
    },
    freshness: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Freshness filter: day, week, month, year, or a YYYY-MM-DDtoYYYY-MM-DD range',
    },
    country: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Two-letter country code to localize results (e.g., US, GB, JP)',
    },
    language: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'BCP 47 language code (e.g., EN, FR, DE). Default: EN',
    },
    safesearch: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Safe search filter level: off, moderate, or strict',
    },
    livecrawl: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Live-crawl sections for full page content: web, news, or all',
    },
    include_domains: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated allowlist of domains (mutually exclusive with exclude_domains)',
    },
    exclude_domains: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated blocklist of domains to exclude from results',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'You.com API Key',
    },
  },

  request: {
    url: (params) => {
      const searchParams = new URLSearchParams({ query: params.query })

      // 'none' is the block's "unset" sentinel for these enum dropdowns; the API rejects it
      const isSet = (value?: string): value is string => Boolean(value) && value !== 'none'

      if (params.count) searchParams.set('count', String(Number(params.count)))
      if (params.offset) searchParams.set('offset', String(Number(params.offset)))
      if (params.freshness) searchParams.set('freshness', params.freshness)
      if (params.country) searchParams.set('country', params.country)
      if (params.language) searchParams.set('language', params.language)
      if (isSet(params.safesearch)) searchParams.set('safesearch', params.safesearch)
      if (isSet(params.livecrawl)) searchParams.set('livecrawl', params.livecrawl)
      if (params.include_domains) searchParams.set('include_domains', params.include_domains)
      if (params.exclude_domains) searchParams.set('exclude_domains', params.exclude_domains)

      return `https://ydc-index.io/v1/search?${searchParams.toString()}`
    },
    method: 'GET',
    headers: (params) => ({
      'X-API-Key': params.apiKey,
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`You.com search failed: ${response.status} - ${errorText}`)
    }

    const data = await response.json()
    const results = data.results ?? {}

    return {
      success: true,
      output: {
        search_uuid: (data.metadata?.search_uuid as string | undefined) ?? null,
        web: ((results.web ?? []) as Record<string, unknown>[]).map((result) => ({
          url: (result.url as string | undefined) ?? null,
          title: (result.title as string | undefined) ?? null,
          description: (result.description as string | undefined) ?? null,
          snippets: (result.snippets as string[] | undefined) ?? [],
          page_age: (result.page_age as string | undefined) ?? null,
          author: Array.isArray(result.authors) ? ((result.authors[0] as string) ?? null) : null,
          favicon_url: (result.favicon_url as string | undefined) ?? null,
          thumbnail_url: (result.thumbnail_url as string | undefined) ?? null,
          contents: (result.contents as Record<string, unknown> | undefined) ?? null,
        })),
        news: ((results.news ?? []) as Record<string, unknown>[]).map((result) => ({
          url: (result.url as string | undefined) ?? null,
          title: (result.title as string | undefined) ?? null,
          description: (result.description as string | undefined) ?? null,
          page_age: (result.page_age as string | undefined) ?? null,
          thumbnail_url: (result.thumbnail_url as string | undefined) ?? null,
          contents: (result.contents as Record<string, unknown> | undefined) ?? null,
        })),
      },
    }
  },

  outputs: {
    search_uuid: {
      type: 'string',
      description: 'Unique identifier for this search request',
      optional: true,
    },
    web: {
      type: 'array',
      description: 'Web search results',
      items: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'The URL of the result' },
          title: { type: 'string', description: 'The title of the result' },
          description: { type: 'string', description: 'Brief summary of the page' },
          snippets: {
            type: 'array',
            description: 'Query-relevant text excerpts from the page',
            items: { type: 'string' },
          },
          page_age: {
            type: 'string',
            description: 'Publication timestamp (ISO 8601)',
            optional: true,
          },
          author: { type: 'string', description: 'Primary content author', optional: true },
          favicon_url: { type: 'string', description: "URL of the site's favicon", optional: true },
          thumbnail_url: { type: 'string', description: 'Preview image URL', optional: true },
          contents: {
            type: 'json',
            description: 'Full page content (only when livecrawl is enabled)',
            optional: true,
          },
        },
      },
    },
    news: {
      type: 'array',
      description: 'News search results',
      items: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'The URL of the article' },
          title: { type: 'string', description: 'The article headline' },
          description: { type: 'string', description: 'Content summary' },
          page_age: {
            type: 'string',
            description: 'Publication timestamp (UTC)',
            optional: true,
          },
          thumbnail_url: { type: 'string', description: 'Preview image URL', optional: true },
          contents: {
            type: 'json',
            description: 'Full page content (only when livecrawl is enabled)',
            optional: true,
          },
        },
      },
    },
  },
}
