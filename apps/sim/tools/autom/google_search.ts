import { toBooleanOrNull, toNumberOrNull, toStringOrNull } from '@sim/utils/coerce'
import { toArray, toRecord, toRecordOrNull } from '@sim/utils/object'
import type {
  AutomGoogleSearchParams,
  AutomGoogleSearchResponse,
  AutomKnowledgeGraph,
  AutomSearchResult,
} from '@/tools/autom/types'
import {
  AUTOM_KNOWLEDGE_GRAPH_OUTPUT_PROPERTIES,
  AUTOM_SEARCH_RESULT_OUTPUT_PROPERTIES,
} from '@/tools/autom/types'
import { mapAutomSearchResult } from '@/tools/autom/utils'
import type { ToolConfig } from '@/tools/types'

/** Reads a `AutomKnowledgeGraph` from an untyped Autom API payload. */
function mapAutomKnowledgeGraph(value: unknown): AutomKnowledgeGraph | null {
  const record = toRecordOrNull(value)
  if (!record) return null
  return {
    title: toStringOrNull(record.title),
    type: toStringOrNull(record.type),
    website: toStringOrNull(record.website),
  }
}

export const automGoogleSearchTool: ToolConfig<AutomGoogleSearchParams, AutomGoogleSearchResponse> =
  {
    id: 'autom_google_search',
    name: 'Autom Google Search',
    description:
      'Search Google and get organic results with their position, title, link and snippet, the knowledge graph and the estimated total.',
    version: '1.0.0',

    params: {
      query: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Search query (e.g., "best electric cars")',
      },
      country: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Two-letter country code to search from (e.g., "us")',
      },
      language: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Two-letter language code of the results (e.g., "en")',
      },
      location: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description:
          'Google location name to search from, as Find Google Locations returns it (e.g., "Paris,Paris,Ile-de-France,France")',
      },
      page: {
        type: 'number',
        required: false,
        visibility: 'user-or-llm',
        description: 'Page of results, starting at 1',
      },
      numResults: {
        type: 'number',
        required: false,
        visibility: 'user-or-llm',
        description: 'Number of results per page (e.g., 10)',
      },
      apiKey: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'Autom API key',
      },
    },

    request: {
      url: (params) => {
        const url = new URL(`https://api.autom.dev/v1/google/search`)
        url.searchParams.set('query', params.query.trim())
        if (params.country?.trim()) url.searchParams.set('gl', params.country.trim())
        if (params.language?.trim()) url.searchParams.set('hl', params.language.trim())
        if (params.location?.trim()) url.searchParams.set('location', params.location.trim())
        if (params.page != null) url.searchParams.set('page', String(params.page))
        if (params.numResults != null) url.searchParams.set('num', String(params.numResults))
        return url.toString()
      },
      method: 'GET',
      headers: (params) => ({
        'x-api-key': params.apiKey,
        Accept: 'application/json',
      }),
    },

    transformResponse: async (response) => {
      const data = toRecord(await response.json())
      return {
        success: true,
        output: {
          results: toArray(data.organic_results)
            .map(mapAutomSearchResult)
            .filter((item): item is AutomSearchResult => item !== null),
          knowledgeGraph: mapAutomKnowledgeGraph(data.knowledge_graph),
          totalResults: toNumberOrNull(toRecord(data.search_information).total_results),
          hasNextPage: toBooleanOrNull(toRecord(data.pagination).has_next_page),
        },
      }
    },

    outputs: {
      results: {
        type: 'array',
        description: 'Organic results',
        optional: true,
        items: { type: 'object', properties: AUTOM_SEARCH_RESULT_OUTPUT_PROPERTIES },
      },
      knowledgeGraph: {
        type: 'object',
        description: 'Knowledge graph panel, when Google shows one',
        optional: true,
        properties: AUTOM_KNOWLEDGE_GRAPH_OUTPUT_PROPERTIES,
      },
      totalResults: {
        type: 'number',
        description: 'Estimated total number of results',
        optional: true,
      },
      hasNextPage: {
        type: 'boolean',
        description: 'Whether another page of results exists',
        optional: true,
      },
    },
  }
