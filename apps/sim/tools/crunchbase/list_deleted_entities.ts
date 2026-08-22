import type { CrunchbaseEntityIdentifier } from '@/tools/crunchbase/types'
import {
  appendCsvParam,
  assertCollection,
  assertCollections,
  assertSingleCursor,
  CRUNCHBASE_API_BASE,
  CRUNCHBASE_DELETED_COLLECTIONS,
  clampLimit,
  crunchbaseError,
  crunchbaseHeaders,
  DELETED_LIMIT_MAX,
  parseIdListParam,
  readJson,
} from '@/tools/crunchbase/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig, ToolResponse } from '@/tools/types'

interface CrunchbaseDeletedEntity {
  deleted_at?: string
  identifier?: CrunchbaseEntityIdentifier
}

interface CrunchbaseListDeletedEntitiesParams {
  apiKey: string
  collection?: string
  collectionIds?: string[] | string
  deletedAtOrder?: string
  limit?: number | string
  afterId?: string
  beforeId?: string
}

interface CrunchbaseListDeletedEntitiesResponse extends ToolResponse {
  output: {
    entities: CrunchbaseDeletedEntity[]
    nextAfterId: string | null
  }
}

export const crunchbaseListDeletedEntitiesTool: ToolConfig<
  CrunchbaseListDeletedEntitiesParams,
  CrunchbaseListDeletedEntitiesResponse
> = {
  id: 'crunchbase_list_deleted_entities',
  name: 'Crunchbase List Deleted Entities',
  description:
    'List entities Crunchbase has deleted, so a mirrored copy can be pruned in step with the source.',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.CRUNCHBASE_ERRORS,

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Crunchbase API key, sent as the X-cb-user-key header',
    },
    collection: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Restrict the feed to a single collection: acquisitions, categories, event_appearances, events, funding_rounds, funds, investments, ipos, jobs, locations, organizations, ownerships, people, or press_references. Which of them your key can read depends on your Crunchbase package. Leave empty to read the feed across collections.',
    },
    collectionIds: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Collections to include when reading the cross-collection feed, e.g. ["organizations","people"]. One or more of: acquisitions, categories, event_appearances, events, funding_rounds, funds, investments, ipos, jobs, locations, organizations, ownerships, people, press_references. Ignored when a single collection is set.',
    },
    deletedAtOrder: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Order by deletion time: "asc" (default) or "desc"',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Rows to return per page, 1-25 (default 10)',
    },
    afterId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'UUID of the last row on the current page, to fetch the next page',
    },
    beforeId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'UUID of the first row on the current page, to fetch the previous page',
    },
  },

  request: {
    url: (params) => {
      assertSingleCursor(params.afterId, params.beforeId)

      const search = new URLSearchParams()
      const scoped = params.collection?.trim()

      if (!scoped) {
        appendCsvParam(
          search,
          'collection_ids',
          assertCollections(
            parseIdListParam(params.collectionIds, 'collectionIds'),
            CRUNCHBASE_DELETED_COLLECTIONS,
            'collectionIds'
          )
        )
      }
      if (params.deletedAtOrder === 'desc' || params.deletedAtOrder === 'asc') {
        search.set('deleted_at_order', params.deletedAtOrder)
      }
      const limit = clampLimit(params.limit, DELETED_LIMIT_MAX)
      if (limit !== undefined) search.set('limit', String(limit))
      if (params.afterId) search.set('after_id', params.afterId)
      if (params.beforeId) search.set('before_id', params.beforeId)

      const path = scoped
        ? `/deleted_entities/${assertCollection(scoped, CRUNCHBASE_DELETED_COLLECTIONS, 'collection')}`
        : '/deleted_entities'
      const qs = search.toString()
      return `${CRUNCHBASE_API_BASE}${path}${qs ? `?${qs}` : ''}`
    },
    method: 'GET',
    headers: (params) => crunchbaseHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) throw await crunchbaseError(response)

    const data = await readJson<{ entities?: CrunchbaseDeletedEntity[] }>(response)
    const entities = Array.isArray(data.entities) ? data.entities : []
    const last = entities[entities.length - 1]

    return {
      success: true,
      output: {
        entities,
        nextAfterId: last?.identifier?.uuid ?? null,
      },
    }
  },

  outputs: {
    entities: {
      type: 'json',
      description:
        'Deleted entities as [{deleted_at, identifier: {uuid, value, permalink, entity_def_id}}]',
    },
    nextAfterId: {
      type: 'string',
      nullable: true,
      description: 'UUID of the last row, to pass as afterId for the next page',
    },
  },
}
