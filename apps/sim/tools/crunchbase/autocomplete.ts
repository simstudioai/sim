import type {
  CrunchbaseAutocompleteEntity,
  CrunchbaseAutocompleteParams,
  CrunchbaseAutocompleteResponse,
} from '@/tools/crunchbase/types'
import {
  AUTOCOMPLETE_LIMIT_MAX,
  appendCsvParam,
  assertCollections,
  CRUNCHBASE_API_BASE,
  CRUNCHBASE_AUTOCOMPLETE_COLLECTIONS,
  clampLimit,
  crunchbaseError,
  crunchbaseHeaders,
  parseIdListParam,
  readJson,
} from '@/tools/crunchbase/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const crunchbaseAutocompleteTool: ToolConfig<
  CrunchbaseAutocompleteParams,
  CrunchbaseAutocompleteResponse
> = {
  id: 'crunchbase_autocomplete',
  name: 'Crunchbase Autocomplete',
  description:
    'Suggest Crunchbase entities matching a typed query, returning the permalinks and UUIDs the lookup and search operations take.',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.CRUNCHBASE_ERRORS,

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Crunchbase API key, sent as the X-cb-user-key header',
    },
    query: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Text to autocomplete against, e.g. "airbnb"',
    },
    collectionIds: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Collections to search, e.g. ["organizations","people"]. One or more of: addresses, categories, category_groups, degrees, diversity_spotlights, event_appearances, events, ipos, jobs, locations, organizations, ownerships, people, principals. Defaults to every collection.',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Suggestions to return, max 25 (default 10)',
    },
  },

  request: {
    url: (params) => {
      const query = params.query?.trim()
      if (!query) throw new Error('Crunchbase "query" is required for autocomplete')

      const search = new URLSearchParams({ query })
      appendCsvParam(
        search,
        'collection_ids',
        assertCollections(
          parseIdListParam(params.collectionIds, 'collectionIds'),
          CRUNCHBASE_AUTOCOMPLETE_COLLECTIONS,
          'collectionIds'
        )
      )
      const limit = clampLimit(params.limit, AUTOCOMPLETE_LIMIT_MAX)
      if (limit !== undefined) search.set('limit', String(limit))

      return `${CRUNCHBASE_API_BASE}/autocompletes?${search.toString()}`
    },
    method: 'GET',
    headers: (params) => crunchbaseHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) throw await crunchbaseError(response)

    const data = await readJson<{ entities?: CrunchbaseAutocompleteEntity[] }>(response)

    return {
      success: true,
      output: {
        entities: Array.isArray(data.entities) ? data.entities : [],
      },
    }
  },

  outputs: {
    entities: {
      type: 'json',
      description:
        'Suggestions as [{identifier: {uuid, value, permalink, image_id, entity_def_id}, facet_ids, short_description}]',
    },
  },
}
