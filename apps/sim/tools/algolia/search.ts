import type { AlgoliaSearchParams, AlgoliaSearchResponse } from '@/tools/algolia/types'
import type { ToolConfig } from '@/tools/types'

export const searchTool: ToolConfig<AlgoliaSearchParams, AlgoliaSearchResponse> = {
  id: 'algolia_search',
  name: 'Algolia Search',
  description: 'Search an Algolia index',
  version: '1.0',

  params: {
    applicationId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Algolia Application ID',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Algolia API Key',
    },
    indexName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name of the Algolia index to search',
    },
    query: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Search query text',
    },
    hitsPerPage: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of hits per page (default: 20)',
    },
    page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page number to retrieve (default: 0)',
    },
    filters: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter string (e.g., "category:electronics AND price < 100")',
    },
    attributesToRetrieve: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated list of attributes to retrieve',
    },
  },

  request: {
    url: (params) => `https://${params.applicationId}-dsn.algolia.net/1/indexes/*/queries`,
    method: 'POST',
    headers: (params) => ({
      'x-algolia-application-id': params.applicationId,
      'x-algolia-api-key': params.apiKey,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const request: Record<string, unknown> = {
        indexName: params.indexName,
        query: params.query,
      }
      if (params.hitsPerPage !== undefined) request.hitsPerPage = Number(params.hitsPerPage)
      if (params.page !== undefined) request.page = Number(params.page)
      if (params.filters) request.filters = params.filters
      if (params.attributesToRetrieve) {
        request.attributesToRetrieve = params.attributesToRetrieve
          .split(',')
          .map((a: string) => a.trim())
      }
      return { requests: [request] }
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()
    const result = data.results?.[0] ?? {}
    return {
      success: true,
      output: {
        hits: result.hits ?? [],
        nbHits: result.nbHits ?? 0,
        page: result.page ?? 0,
        nbPages: result.nbPages ?? 0,
        hitsPerPage: result.hitsPerPage ?? 20,
        processingTimeMS: result.processingTimeMS ?? 0,
        query: result.query ?? '',
        parsedQuery: result.parsedQuery ?? null,
        facets: result.facets ?? null,
        facets_stats: result.facets_stats ?? null,
        exhaustive: result.exhaustive ?? null,
      },
    }
  },

  outputs: {
    hits: {
      type: 'array',
      description: 'Array of matching records',
      items: {
        type: 'object',
        description:
          'A search result hit containing objectID plus any user-defined attributes from the index',
        properties: {
          objectID: {
            type: 'string',
            description: 'Unique identifier of the record',
          },
          _highlightResult: {
            type: 'object',
            description:
              'Highlighted attributes matching the query. Each attribute has value, matchLevel (none, partial, full), and matchedWords',
            optional: true,
          },
          _snippetResult: {
            type: 'object',
            description:
              'Snippeted attributes matching the query. Each attribute has value and matchLevel',
            optional: true,
          },
          _rankingInfo: {
            type: 'object',
            description:
              'Ranking information for the hit. Only present when getRankingInfo is enabled',
            optional: true,
            properties: {
              nbTypos: { type: 'number', description: 'Number of typos in the query match' },
              firstMatchedWord: {
                type: 'number',
                description: 'Position of the first matched word',
              },
              geoDistance: {
                type: 'number',
                description: 'Distance in meters for geo-search results',
              },
              nbExactWords: {
                type: 'number',
                description: 'Number of exactly matched words',
              },
              userScore: { type: 'number', description: 'Custom ranking score' },
              words: { type: 'number', description: 'Number of matched words' },
            },
          },
        },
      },
    },
    nbHits: {
      type: 'number',
      description: 'Total number of matching hits',
    },
    page: {
      type: 'number',
      description: 'Current page number (zero-based)',
    },
    nbPages: {
      type: 'number',
      description: 'Total number of pages available',
    },
    hitsPerPage: {
      type: 'number',
      description: 'Number of hits per page (1-1000, default 20)',
    },
    processingTimeMS: {
      type: 'number',
      description: 'Server-side processing time in milliseconds',
    },
    query: {
      type: 'string',
      description: 'The search query that was executed',
    },
    parsedQuery: {
      type: 'string',
      description: 'The query string after normalization and stop word removal',
      optional: true,
    },
    facets: {
      type: 'object',
      description: 'Facet counts keyed by facet name, each containing value-count pairs',
      optional: true,
    },
    facets_stats: {
      type: 'object',
      description: 'Statistics (min, max, avg, sum) for numeric facets',
      optional: true,
    },
    exhaustive: {
      type: 'object',
      description:
        'Exhaustiveness flags for facetsCount, facetValues, nbHits, rulesMatch, and typo',
      optional: true,
    },
  },
}
