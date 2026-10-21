import { toStringOrNull } from '@sim/utils/coerce'
import { filterUndefined, toArray, toRecord, toRecordOrNull } from '@sim/utils/object'
import type { MrScraperSearchParams, MrScraperSearchResponse } from '@/tools/mrscraper/types'
import {
  getMrScraperError,
  getMrScraperHeaders,
  getMrScraperNumber,
  requireMrScraperObject,
  validateMrScraperBoolean,
  validateMrScraperInteger,
} from '@/tools/mrscraper/utils'
import type { ToolConfig } from '@/tools/types'

function getSearchInput(params: MrScraperSearchParams): Record<string, unknown> {
  if (typeof params.query !== 'string') {
    throw new Error('A search query or Google search URL is required.')
  }
  const value = params.query.trim()
  if (!value) throw new Error('A search query or Google search URL is required.')
  let query = value
  let region: string | undefined
  let language: string | undefined
  let page: number | undefined
  if (/^https?:\/\//i.test(value)) {
    const url = new URL(value)
    query = url.searchParams.get('q')?.trim() || ''
    if (!query) throw new Error('A Google search URL must contain a q parameter.')
    region = url.searchParams.get('gl') || undefined
    language = url.searchParams.get('hl') || undefined
    const start = Number(url.searchParams.get('start'))
    if (Number.isSafeInteger(start) && start > 0) page = Math.floor(start / 10) + 1
  }
  const format = params.format ?? 'json'
  if (format !== 'json' && format !== 'html') {
    throw new Error('Search format must be json or html.')
  }
  return filterUndefined({
    query,
    region: params.region?.trim() || region,
    language: params.language?.trim() || language,
    page: validateMrScraperInteger(params.page, 'Page', 1) ?? page,
    format,
    renderJs: validateMrScraperBoolean(params.renderJs, 'Render JavaScript') ?? false,
  })
}

export const mrScraperSearchTool: ToolConfig<MrScraperSearchParams, MrScraperSearchResponse> = {
  id: 'mrscraper_search',
  name: 'MrScraper Search',
  description:
    'Search Google from query text or a Google search URL and return organic results, search metadata, pagination, or the raw results-page HTML.',
  version: '1.0.0',
  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'MrScraper API key from https://app.mrscraper.com.',
    },
    query: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Search query or Google search URL with q, gl, hl, and start parameters.',
    },
    format: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      default: 'json',
      description: 'json returns parsed results; html returns results-page HTML. Defaults to json.',
    },
    region: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Country code such as us, gb, or id. Overrides gl from a Google URL.',
    },
    language: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Language code such as en, es, or id. Overrides hl from a Google URL.',
    },
    page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'One-based result page. Overrides the page derived from a Google URL start parameter.',
    },
    renderJs: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      default: false,
      description: 'Wait for JavaScript-dependent search features such as AI Overview to load.',
    },
  },
  request: {
    method: 'POST',
    url: 'https://sync.scraper.mrscraper.com/api/google/serp/v2/sync',
    headers: (params) => getMrScraperHeaders(params.apiKey),
    body: getSearchInput,
  },
  transformResponse: async (response) => {
    const body = requireMrScraperObject(await response.json(), 'search response')
    const error = getMrScraperError(body)
    const data = error ? toRecord(body.data) : requireMrScraperObject(body.data, 'search data')
    const general = toRecordOrNull(data.general)
    const pagination = toRecordOrNull(data.pagination)
    return {
      success: !error,
      ...(error ? { error } : {}),
      output: {
        searchResults: toArray(data.organic).map((value) => {
          const item = toRecord(value)
          return {
            title: toStringOrNull(item.title),
            link: toStringOrNull(item.link),
            description: toStringOrNull(item.description),
            source: toStringOrNull(item.source),
            displayLink: toStringOrNull(item.display_link),
            rank: getMrScraperNumber(item.rank),
            globalRank: getMrScraperNumber(item.global_rank),
          }
        }),
        html: toStringOrNull(data.html),
        general: general
          ? {
              query: toStringOrNull(general.query),
              resultsCount: getMrScraperNumber(general.results_cnt),
              searchTime: getMrScraperNumber(general.search_time),
              language: toStringOrNull(general.language),
              location: toStringOrNull(general.location),
              pageTitle: toStringOrNull(general.page_title),
              timestamp: toStringOrNull(general.timestamp),
            }
          : null,
        pagination: pagination
          ? {
              currentPage: getMrScraperNumber(pagination.current_page),
              nextPage: getMrScraperNumber(pagination.next_page),
              nextPageStart: getMrScraperNumber(pagination.next_page_start),
              nextPageLink: toStringOrNull(pagination.next_page_link),
              pages: toArray(pagination.pages).map((value) => {
                const page = toRecord(value)
                return {
                  page: getMrScraperNumber(page.page),
                  start: getMrScraperNumber(page.start),
                  link: toStringOrNull(page.link),
                }
              }),
            }
          : null,
        tokenUsage: getMrScraperNumber(body.tokenUsage),
      },
    }
  },
  outputs: {
    searchResults: {
      type: 'array',
      description: 'Organic Google results in ranking order. Empty for HTML format.',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Result title.', nullable: true },
          link: { type: 'string', description: 'Destination URL.', nullable: true },
          description: {
            type: 'string',
            description: 'Result description or snippet.',
            nullable: true,
          },
          source: { type: 'string', description: 'Source name.', nullable: true },
          displayLink: {
            type: 'string',
            description: 'Displayed URL or breadcrumb.',
            nullable: true,
          },
          rank: { type: 'number', description: 'Position among organic results.', nullable: true },
          globalRank: {
            type: 'number',
            description: 'Position among all search result features.',
            nullable: true,
          },
        },
      },
    },
    html: {
      type: 'string',
      description: 'Raw results-page HTML when format is html.',
      nullable: true,
    },
    general: {
      type: 'object',
      description: 'Search metadata for parsed JSON results.',
      nullable: true,
      properties: {
        query: { type: 'string', description: 'Search query.', nullable: true },
        resultsCount: {
          type: 'number',
          description: 'Number of results reported by the parser.',
          nullable: true,
        },
        searchTime: {
          type: 'number',
          description: 'Search time reported by Google in seconds.',
          nullable: true,
        },
        language: { type: 'string', description: 'Search language.', nullable: true },
        location: { type: 'string', description: 'Search country.', nullable: true },
        pageTitle: { type: 'string', description: 'Results-page title.', nullable: true },
        timestamp: { type: 'string', description: 'Search response timestamp.', nullable: true },
      },
    },
    pagination: {
      type: 'object',
      description: 'Current page and links for continuing a parsed search.',
      nullable: true,
      properties: {
        currentPage: { type: 'number', description: 'Current result page.', nullable: true },
        nextPage: { type: 'number', description: 'Next result page.', nullable: true },
        nextPageStart: {
          type: 'number',
          description: 'Google start offset of the next page.',
          nullable: true,
        },
        nextPageLink: {
          type: 'string',
          description: 'Google URL for the next page.',
          nullable: true,
        },
        pages: {
          type: 'array',
          description: 'Available result pages.',
          items: {
            type: 'object',
            properties: {
              page: { type: 'number', description: 'One-based page number.', nullable: true },
              start: { type: 'number', description: 'Google start offset.', nullable: true },
              link: { type: 'string', description: 'Google result-page URL.', nullable: true },
            },
          },
        },
      },
    },
    tokenUsage: {
      type: 'number',
      description: 'Plan tokens consumed by the search request.',
      nullable: true,
    },
  },
}
