import type {
  NewRelicEntity,
  NewRelicSearchEntitiesParams,
  NewRelicSearchEntitiesResponse,
} from '@/tools/new_relic/types'
import {
  getNerdGraphEndpoint,
  newRelicHeaders,
  parseNerdGraphResponse,
} from '@/tools/new_relic/utils'
import type { ToolConfig } from '@/tools/types'

interface SearchEntitiesData {
  actor?: {
    entitySearch?: {
      count?: number
      query?: string
      results?: {
        nextCursor?: string | null
        entities?: NewRelicEntity[]
      } | null
    } | null
  } | null
}

export const newRelicSearchEntitiesTool: ToolConfig<
  NewRelicSearchEntitiesParams,
  NewRelicSearchEntitiesResponse
> = {
  id: 'new_relic_search_entities',
  name: 'New Relic Search Entities',
  description: 'Search New Relic entities by name, GUID, domain type, tags, or reporting state.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'New Relic user API key for NerdGraph',
    },
    region: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'New Relic data center region: us or eu',
    },
    query: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Entity search query, for example: name like "api" or domainType = "APM-APPLICATION"',
    },
    cursor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination cursor from a previous entity search',
    },
  },

  request: {
    url: (params) => getNerdGraphEndpoint(params.region),
    method: 'POST',
    headers: (params) => newRelicHeaders(params.apiKey),
    body: (params) => ({
      query: `query($query: String!, $cursor: String) {
  actor {
    entitySearch(query: $query) {
      count
      query
      results(cursor: $cursor) {
        nextCursor
        entities {
          guid
          name
          entityType
        }
      }
    }
  }
}`,
      variables: {
        query: params.query,
        cursor: params.cursor || null,
      },
    }),
  },

  transformResponse: async (response) => {
    const payload = await parseNerdGraphResponse<SearchEntitiesData>(response)
    const entitySearch = payload.data?.actor?.entitySearch
    if (!entitySearch) {
      throw new Error('New Relic did not return entity search data')
    }
    const entities = entitySearch?.results?.entities ?? []

    return {
      success: true,
      output: {
        count: entitySearch?.count ?? entities.length,
        query: entitySearch?.query ?? '',
        entities,
        nextCursor: entitySearch?.results?.nextCursor ?? null,
      },
    }
  },

  outputs: {
    count: { type: 'number', description: 'Total number of entities matching the query' },
    query: { type: 'string', description: 'Entity search query New Relic executed' },
    entities: {
      type: 'array',
      description: 'Matching New Relic entities',
      items: {
        type: 'object',
        properties: {
          guid: { type: 'string', description: 'Entity GUID', nullable: true },
          name: { type: 'string', description: 'Entity name', nullable: true },
          entityType: { type: 'string', description: 'Entity type', nullable: true },
        },
      },
    },
    nextCursor: {
      type: 'string',
      description: 'Cursor for the next page of results',
      optional: true,
    },
  },
}
