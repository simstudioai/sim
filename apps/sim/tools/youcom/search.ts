import { toNumberOrNull, toStringOrNull } from '@sim/utils/coerce'
import { toArray, toRecordOrNull } from '@sim/utils/object'
import type { ToolConfig } from '@/tools/types'
import type { YouComSearchParams, YouComSearchResponse } from '@/tools/youcom/types'
import {
  buildDomainFilters,
  optionalNumber,
  parseList,
  toCode,
  YOUCOM_INDEX_BASE_URL,
  youComApiKeyParam,
  youComHeaders,
} from '@/tools/youcom/utils'

export const youComSearchTool: ToolConfig<YouComSearchParams, YouComSearchResponse> = {
  id: 'youcom_search',
  name: 'You.com Search',
  description:
    'Search the web and news with You.com, returning LLM-ready results with optional query-relevant highlights or full page content.',
  version: '1.0.0',

  params: {
    query: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Search query. Supports search operators such as site: and filetype:',
    },
    count: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum results to return per section (web and news). Defaults to 10',
    },
    offset: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page offset in multiples of count, from 0 to 9. Defaults to 0',
    },
    freshness: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Result recency: day, week, month, year, or a range like 2025-01-01to2025-12-31',
    },
    country: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Two-letter country code that sets the geographic focus (e.g., US, GB, DE)',
    },
    language: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'BCP 47 language code for results (e.g., EN, FR, ZH-HANS). Defaults to EN',
    },
    safesearch: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Content moderation filter: off, moderate, or strict. Defaults to moderate',
    },
    knowledge: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Set to core to also return knowledge results from licensed data providers',
    },
    includeDomains: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated domains to restrict results to (up to 500). Cannot be combined with exclude or boost domains',
    },
    excludeDomains: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated domains to remove from results (up to 500)',
    },
    boostDomains: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated domains to rank higher without filtering others (up to 500)',
    },
    extractionMode: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Content to extract per result: highlights (query-relevant passages) or full_page. Omit for snippets only',
    },
    extractionSource: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Where full_page content comes from: blend (cache, then live crawl), cache, or fetch. Defaults to blend',
    },
    extractionFormats: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated full_page formats: markdown, html, or both. Defaults to markdown',
    },
    crawlTimeout: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Seconds to wait for page content when crawling, from 1 to 60. Defaults to 10',
    },
    apiKey: youComApiKeyParam,
  },

  request: {
    url: `${YOUCOM_INDEX_BASE_URL}/search`,
    method: 'POST',
    headers: youComHeaders,
    body: (params) => {
      const body: Record<string, unknown> = {
        query: params.query,
        ...buildDomainFilters(params),
      }
      const count = optionalNumber(params.count)
      if (count !== undefined) body.count = count
      const offset = optionalNumber(params.offset)
      if (offset !== undefined) body.offset = offset
      if (params.freshness) body.freshness = params.freshness.trim()
      const country = toCode(params.country)
      if (country) body.country = country
      const language = toCode(params.language)
      if (language) body.language = language
      if (params.safesearch) body.safesearch = params.safesearch
      if (params.knowledge) body.knowledge = params.knowledge
      const crawlTimeout = optionalNumber(params.crawlTimeout)
      if (crawlTimeout !== undefined) body.crawl_timeout = crawlTimeout

      if (params.extractionMode) {
        const extraction: Record<string, unknown> = { extraction_mode: params.extractionMode }
        if (params.extractionMode === 'full_page') {
          if (params.extractionSource) extraction.extraction_source = params.extractionSource
          const formats = parseList(params.extractionFormats)
          if (formats) extraction.full_page = { extraction_formats: formats }
        }
        body.extraction = extraction
      }

      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    const results = toRecordOrNull(data.results) ?? {}
    const metadata = toRecordOrNull(data.metadata) ?? {}

    return {
      success: true,
      output: {
        web: toArray(results.web).map((item) => {
          const result = toRecordOrNull(item) ?? {}
          const contents = toRecordOrNull(result.contents) ?? {}
          return {
            url: toStringOrNull(result.url),
            title: toStringOrNull(result.title),
            description: toStringOrNull(result.description),
            snippets: toArray(result.snippets).map(String),
            thumbnailUrl: toStringOrNull(result.thumbnail_url),
            faviconUrl: toStringOrNull(result.favicon_url),
            pageAge: toStringOrNull(result.page_age),
            highlights: toArray(contents.highlights).map(String),
            html: toStringOrNull(contents.html),
            markdown: toStringOrNull(contents.markdown),
          }
        }),
        news: toArray(results.news).map((item) => {
          const result = toRecordOrNull(item) ?? {}
          const contents = toRecordOrNull(result.contents) ?? {}
          return {
            url: toStringOrNull(result.url),
            title: toStringOrNull(result.title),
            description: toStringOrNull(result.description),
            thumbnailUrl: toStringOrNull(result.thumbnail_url),
            pageAge: toStringOrNull(result.page_age),
            html: toStringOrNull(contents.html),
            markdown: toStringOrNull(contents.markdown),
          }
        }),
        knowledge: toArray(results.knowledge).map((item) => {
          const result = toRecordOrNull(item) ?? {}
          return {
            type: String(result.type ?? ''),
            title: String(result.title ?? ''),
            description: toStringOrNull(result.description),
            asOf: toStringOrNull(result.as_of),
            attribution: toArray(result.attribution).map((entry) => {
              const credit = toRecordOrNull(entry) ?? {}
              return {
                name: String(credit.name ?? ''),
                sourceDescription: toStringOrNull(credit.source_description),
              }
            }),
          }
        }),
        searchUuid: toStringOrNull(metadata.search_uuid),
        query: toStringOrNull(metadata.query),
        latency: toNumberOrNull(metadata.latency),
      },
    }
  },

  outputs: {
    web: {
      type: 'array',
      description: 'Web results',
      items: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL of the result', nullable: true },
          title: { type: 'string', description: 'Title of the result', nullable: true },
          description: {
            type: 'string',
            description: 'Brief description of the result',
            nullable: true,
          },
          snippets: {
            type: 'array',
            description:
              'Short keyword-centered fragments (omitted when highlights extraction is used)',
            items: { type: 'string' },
          },
          thumbnailUrl: { type: 'string', description: 'Thumbnail URL', nullable: true },
          faviconUrl: {
            type: 'string',
            description: "Favicon URL of the result's domain",
            nullable: true,
          },
          pageAge: { type: 'string', description: 'Age of the result', nullable: true },
          highlights: {
            type: 'array',
            description: 'Query-relevant passages (highlights extraction only)',
            items: { type: 'string' },
          },
          html: { type: 'string', description: 'Full page HTML (full_page only)', nullable: true },
          markdown: {
            type: 'string',
            description: 'Full page Markdown (full_page only)',
            nullable: true,
          },
        },
      },
    },
    news: {
      type: 'array',
      description: 'News results',
      items: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL of the article', nullable: true },
          title: { type: 'string', description: 'Title of the article', nullable: true },
          description: {
            type: 'string',
            description: 'Brief description of the article',
            nullable: true,
          },
          thumbnailUrl: { type: 'string', description: 'Thumbnail URL', nullable: true },
          pageAge: { type: 'string', description: 'UTC publication timestamp', nullable: true },
          html: { type: 'string', description: 'Full page HTML (full_page only)', nullable: true },
          markdown: {
            type: 'string',
            description: 'Full page Markdown (full_page only)',
            nullable: true,
          },
        },
      },
    },
    knowledge: {
      type: 'array',
      description: 'Knowledge results from licensed data providers (when knowledge is core)',
      items: {
        type: 'object',
        properties: {
          type: { type: 'string', description: 'Kind of knowledge result (currently answer)' },
          title: { type: 'string', description: 'Title of the knowledge result' },
          description: {
            type: 'string',
            description: 'Knowledge drawn from licensed data',
            nullable: true,
          },
          asOf: {
            type: 'string',
            description: 'Date the data covers (YYYY-MM-DD)',
            nullable: true,
          },
          attribution: {
            type: 'array',
            description: 'Data provider credits',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string', description: 'Data provider name' },
                sourceDescription: {
                  type: 'string',
                  description: 'Description of the provider',
                  nullable: true,
                },
              },
            },
          },
        },
      },
    },
    searchUuid: { type: 'string', description: 'Unique ID of the search', nullable: true },
    query: { type: 'string', description: 'Query used to retrieve the results', nullable: true },
    latency: { type: 'number', description: 'Search latency in seconds', nullable: true },
  },
}
