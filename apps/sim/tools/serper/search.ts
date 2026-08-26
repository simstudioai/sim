import type {
  SearchParams,
  SearchResponse,
  SearchResult,
  SerperKnowledgeGraph,
  SerperPeopleAlsoAsk,
  SerperRelatedSearch,
} from '@/tools/serper/types'
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
      source: item.source as string | undefined,
    }),
  },
  /**
   * Shape of an item from `https://google.serper.dev/places` — NOT from `/maps`. Both endpoints
   * return a top-level `places` array with different item shapes, and only `/maps` carries the
   * top-level `ll` field. The `/places` item is
   * `address, category, cid, latitude, longitude, phoneNumber, position, rating, ratingCount,
   * title, website`.
   *
   * It carries no `link` (Serper returns `website`, the business site, which is not a search
   * result URL and must not be presented as one) and no snippet analogue at all — `description`
   * and `type` are Maps-only keys and are absent here. The category is `category`; the review
   * count is `ratingCount`. `latitude`/`longitude` are surfaced so callers can rank by proximity.
   */
  places: {
    responseKey: 'places',
    toResult: (item, index) => ({
      title: item.title as string,
      position: index + 1,
      rating: item.rating as number | undefined,
      ratingCount: item.ratingCount as number | undefined,
      address: item.address as string | undefined,
      latitude: item.latitude as number | undefined,
      longitude: item.longitude as number | undefined,
      category: item.category as string | undefined,
      phoneNumber: item.phoneNumber as string | undefined,
      website: item.website as string | undefined,
    }),
  },
  /**
   * `/images` items carry no `snippet`. The published item shape is `domain, googleUrl,
   * imageHeight, imageUrl, imageWidth, link, position, source, thumbnailHeight, thumbnailUrl,
   * thumbnailWidth, title`.
   */
  images: {
    responseKey: 'images',
    toResult: (item, index) => ({
      title: item.title as string,
      link: item.link as string,
      position: index + 1,
      imageUrl: item.imageUrl as string | undefined,
      thumbnailUrl: item.thumbnailUrl as string | undefined,
      source: item.source as string | undefined,
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
      channel: item.channel as string | undefined,
      duration: item.duration as string | undefined,
      imageUrl: item.imageUrl as string | undefined,
    }),
  },
  /**
   * `/shopping` items carry no `snippet`. The published item shape is `delivery, imageUrl, link,
   * offers, position, price, productId, rating, ratingCount, source, title`.
   */
  shopping: {
    responseKey: 'shopping',
    toResult: (item, index) => ({
      title: item.title as string,
      link: item.link as string,
      position: index + 1,
      source: item.source as string | undefined,
      price: item.price as string | undefined,
      delivery: item.delivery as string | undefined,
      rating: item.rating as number | undefined,
      ratingCount: item.ratingCount as number | undefined,
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
    'Search Google through the Serper.dev API. Supports the web, news, places, images, videos, shopping, scholar, and patents verticals, and returns a flat list of results for the requested vertical with its type-specific metadata (date and source for news, rating, review count, address, coordinates, category, phone, and website for places, image and thumbnail URLs for images, duration and channel for videos, price, delivery, and rating for shopping). The web vertical additionally returns the knowledge graph, "people also ask", and related searches when Google renders them.',
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
      /**
       * `num` is `user-or-llm`, so it can arrive as a non-numeric string. `Number()` alone would
       * put a JSON `null` on the wire for those; only forward a finite number.
       */
      const num = Number(params.num)
      if (params.num && Number.isFinite(num)) body.num = num
      if (params.gl) body.gl = params.gl
      if (params.hl) body.hl = params.hl

      return body
    },
  },

  transformResponse: async (response: Response, params?: SearchParams) => {
    const data = await response.json()

    const searchType = resolveSearchType(params?.type ?? verticalFromUrl(response.url))
    const vertical = SERPER_VERTICALS[searchType]
    const items = data[vertical.responseKey]
    const searchResults: SearchResult[] = Array.isArray(items)
      ? items.map((item, index) => vertical.toResult(item, index))
      : []

    const output: SearchResponse['output'] = { searchResults }

    /**
     * `knowledgeGraph`, `peopleAlsoAsk` and `relatedSearches` are documented only on the `search`
     * vertical, so they are gated on it rather than read opportunistically — a same-named key on
     * another vertical's payload would otherwise be passed through under a shape callers cannot
     * rely on. Each key is also omitted per response, since Google renders these blocks only for
     * some queries.
     */
    if (searchType === 'search') {
      const knowledgeGraph = data.knowledgeGraph as SerperKnowledgeGraph | undefined
      if (knowledgeGraph && typeof knowledgeGraph === 'object') {
        output.knowledgeGraph = knowledgeGraph
      }
      if (Array.isArray(data.peopleAlsoAsk)) {
        output.peopleAlsoAsk = data.peopleAlsoAsk as SerperPeopleAlsoAsk[]
      }
      if (Array.isArray(data.relatedSearches)) {
        output.relatedSearches = data.relatedSearches as SerperRelatedSearch[]
      }
    }

    return {
      success: true,
      output,
    }
  },

  outputs: {
    searchResults: {
      type: 'array',
      description:
        'Results for the requested vertical, with titles, links, snippets, and type-specific metadata (date/source for news, rating/ratingCount/address/latitude/longitude/category/phoneNumber/website for places, imageUrl/thumbnailUrl/source for images, duration/channel/source for videos, price/delivery/rating/ratingCount/source for shopping). Places, images, and shopping results have no snippet; places results have no link.',
      items: {
        type: 'object',
        properties: SERPER_SEARCH_RESULT_OUTPUT_PROPERTIES,
      },
    },
    knowledgeGraph: {
      type: 'object',
      description:
        'Google knowledge panel for the query. Only returned by the web search vertical, and only when Google renders a panel.',
      optional: true,
      properties: {
        title: { type: 'string', description: 'Entity name', optional: true },
        type: { type: 'string', description: 'Entity type, e.g. "Website"', optional: true },
        website: { type: 'string', description: 'Entity website URL', optional: true },
        imageUrl: { type: 'string', description: 'Entity image URL', optional: true },
        description: { type: 'string', description: 'Entity description', optional: true },
        descriptionSource: {
          type: 'string',
          description: 'Publication the description was taken from, e.g. "Wikipedia"',
          optional: true,
        },
        descriptionLink: {
          type: 'string',
          description: 'URL of the description source',
          optional: true,
        },
        attributes: {
          type: 'object',
          description: 'Key/value facts Google lists in the panel',
          optional: true,
        },
      },
    },
    peopleAlsoAsk: {
      type: 'array',
      description:
        'Google "People also ask" entries. Only returned by the web search vertical, and only when Google renders the block.',
      optional: true,
      items: {
        type: 'object',
        properties: {
          question: { type: 'string', description: 'The question asked', optional: true },
          snippet: { type: 'string', description: 'Answer snippet', optional: true },
          title: { type: 'string', description: 'Title of the answering page', optional: true },
          link: { type: 'string', description: 'URL of the answering page', optional: true },
        },
      },
    },
    relatedSearches: {
      type: 'array',
      description:
        'Google "Related searches" queries. Only returned by the web search vertical, and only when Google renders the block.',
      optional: true,
      items: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The related query text', optional: true },
        },
      },
    },
  },
}
