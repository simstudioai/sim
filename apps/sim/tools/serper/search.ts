import type { SearchParams, SearchResponse, SearchResult } from '@/tools/serper/types'
import { SERPER_SEARCH_RESULT_OUTPUT_PROPERTIES } from '@/tools/serper/types'
import type { ToolConfig } from '@/tools/types'

/** Every Serper vertical this tool is verified to speak. */
type SerperSearchType = NonNullable<SearchParams['type']>

interface SerperVertical {
  /** Key on the Serper JSON payload holding this vertical's result array. */
  responseKey: string
  /** Projects one raw Serper item onto the unified {@link SearchResult} shape. */
  toResult: (item: Record<string, unknown>, index: number) => SearchResult
}

/**
 * Keyed dispatch for every supported vertical. Typing this as a `Record` over the
 * `SearchParams['type']` union makes it a compile-time completeness gate: widening the union
 * without adding the matching entry fails the build, instead of silently falling through to the
 * organic branch and returning an empty (but billed) result set.
 */
const SERPER_VERTICALS: Record<SerperSearchType, SerperVertical> = {
  search: {
    responseKey: 'organic',
    toResult: (item, index) => ({
      title: item.title as string,
      link: item.link as string,
      snippet: item.snippet as string | undefined,
      position: index + 1,
      date: item.date as string | undefined,
    }),
  },
  news: {
    responseKey: 'news',
    toResult: (item, index) => ({
      title: item.title as string,
      link: item.link as string,
      snippet: item.snippet as string | undefined,
      position: index + 1,
      date: item.date as string | undefined,
      imageUrl: item.imageUrl as string | undefined,
    }),
  },
  places: {
    responseKey: 'places',
    toResult: (item, index) => ({
      title: item.title as string,
      link: item.link as string,
      snippet: item.snippet as string | undefined,
      position: index + 1,
      rating: item.rating as number | undefined,
      reviews: item.reviews as number | undefined,
      address: item.address as string | undefined,
    }),
  },
  images: {
    responseKey: 'images',
    toResult: (item, index) => ({
      title: item.title as string,
      link: item.link as string,
      snippet: item.snippet as string | undefined,
      position: index + 1,
      imageUrl: item.imageUrl as string | undefined,
    }),
  },
  videos: {
    responseKey: 'videos',
    toResult: (item, index) => ({
      title: item.title as string,
      link: item.link as string,
      snippet: item.snippet as string | undefined,
      position: index + 1,
      date: item.date as string | undefined,
      source: item.source as string | undefined,
      duration: item.duration as string | undefined,
    }),
  },
  shopping: {
    responseKey: 'shopping',
    toResult: (item, index) => ({
      title: item.title as string,
      link: item.link as string,
      snippet: item.snippet as string | undefined,
      position: index + 1,
      source: item.source as string | undefined,
      price: item.price as string | undefined,
      imageUrl: item.imageUrl as string | undefined,
    }),
  },
  /**
   * `organic` is the confirmed top-level key for both `scholar` and `patents`, verified against the
   * example responses Serper publishes on the vertical tabs of serper.dev. Those are published
   * examples rather than a formal schema, so treat them as the best available source.
   *
   * Both verticals return richer per-item fields than the unified {@link SearchResult} shape
   * surfaces today (`scholar`: `publicationInfo`, `year`, `citedBy`; `patents`: `priorityDate`,
   * `filingDate`, `grantDate`, `publicationDate`, `inventor`, `assignee`, `publicationNumber`,
   * and others). Neither returns a `date` key.
   */
  scholar: {
    responseKey: 'organic',
    toResult: (item, index) => ({
      title: item.title as string,
      link: item.link as string,
      snippet: item.snippet as string | undefined,
      position: index + 1,
    }),
  },
  patents: {
    responseKey: 'organic',
    toResult: (item, index) => ({
      title: item.title as string,
      link: item.link as string,
      snippet: item.snippet as string | undefined,
      position: index + 1,
    }),
  },
}

const SERPER_SEARCH_TYPES = new Set<string>(Object.keys(SERPER_VERTICALS))

const SERPER_SEARCH_TYPE_LIST = Object.keys(SERPER_VERTICALS).join(', ')

/**
 * Narrows a free-form `type` to a vertical the dispatch table handles. `type` is `user-or-llm`
 * visible and is interpolated into the request path, so an unhandled value must fail loudly rather
 * than reach Serper and come back as a shape this tool would flatten to an empty result set.
 */
function resolveSearchType(type: string | undefined): SerperSearchType {
  const candidate = type || 'search'
  if (!SERPER_SEARCH_TYPES.has(candidate)) {
    throw new Error(
      `Unsupported Serper search type "${candidate}". Supported types: ${SERPER_SEARCH_TYPE_LIST}.`
    )
  }
  return candidate as SerperSearchType
}

/**
 * Recovers the vertical from a request URL. Only a fallback for callers that invoke
 * `transformResponse` without `params` — `response.url` is server-influenced, is empty on some
 * fetch/mock paths, and can carry a query string or a redirect target. Returns `undefined` when it
 * yields nothing usable — empty, unparseable, or a segment that names no known vertical — so the
 * caller falls back to the default vertical instead of dispatching on a partial value. A
 * server-controlled URL must never turn a successful response into a thrown error; only a
 * user-supplied `params.type` hard-fails, via {@link resolveSearchType}.
 */
function verticalFromUrl(url: string | undefined): SerperSearchType | undefined {
  if (!url) return undefined
  let segment: string | undefined
  try {
    segment = new URL(url).pathname.split('/').pop() || undefined
  } catch {
    return undefined
  }
  return segment && SERPER_SEARCH_TYPES.has(segment) ? (segment as SerperSearchType) : undefined
}

export const searchTool: ToolConfig<SearchParams, SearchResponse> = {
  id: 'serper_search',
  name: 'Web Search',
  description:
    'A powerful web search tool that provides access to Google search results through Serper.dev API. Supports different types of searches including regular web search, news, places, images, videos, and shopping. Returns comprehensive results including organic results, knowledge graph, answer box, people also ask, related searches, and top stories.',
  version: '1.0.0',

  params: {
    query: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The search query (e.g., "latest AI news", "best restaurants in NYC")',
    },
    num: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of results to return (e.g., 10, 20, 50)',
    },
    gl: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Country code for search results (e.g., "us", "uk", "de", "fr")',
    },
    hl: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Language code for search results (e.g., "en", "es", "de", "fr")',
    },
    type: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Type of search to perform. Must be one of "search", "news", "places", "images", "videos", "shopping", "scholar", "patents" — any other value is rejected.',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Serper API Key',
    },
  },

  hosting: {
    envKeyPrefix: 'SERPER_API_KEY',
    apiKeyParam: 'apiKey',
    byokProviderId: 'serper',
    pricing: {
      type: 'custom',
      getCost: (params, output) => {
        if (!Array.isArray(output.searchResults)) {
          throw new Error('Serper response missing searchResults, cannot determine cost')
        }
        const num = Number(params.num) || 10
        const credits = num > 10 ? 2 : 1
        const cost = credits * 0.001
        return { cost, metadata: { num, credits } }
      },
    },
    rateLimit: {
      mode: 'per_request',
      requestsPerMinute: 100,
    },
  },

  request: {
    url: (params) => `https://google.serper.dev/${resolveSearchType(params.type)}`,
    method: 'POST',
    headers: (params) => ({
      'X-API-KEY': params.apiKey,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, any> = {
        q: params.query,
      }

      // Only include optional parameters if they are explicitly set
      if (params.num) body.num = Number(params.num)
      if (params.gl) body.gl = params.gl
      if (params.hl) body.hl = params.hl

      return body
    },
  },

  transformResponse: async (response: Response, params?: SearchParams) => {
    const data = await response.json()

    const vertical =
      SERPER_VERTICALS[resolveSearchType(params?.type ?? verticalFromUrl(response.url))]
    const items = data[vertical.responseKey]
    const searchResults: SearchResult[] = Array.isArray(items)
      ? items.map((item, index) => vertical.toResult(item, index))
      : []

    return {
      success: true,
      output: {
        searchResults,
      },
    }
  },

  outputs: {
    searchResults: {
      type: 'array',
      description:
        'Search results with titles, links, snippets, and type-specific metadata (date for news, rating for places, imageUrl for images, duration/source for videos, price/source for shopping)',
      items: {
        type: 'object',
        properties: SERPER_SEARCH_RESULT_OUTPUT_PROPERTIES,
      },
    },
  },
}
