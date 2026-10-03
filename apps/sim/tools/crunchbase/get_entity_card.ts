import type { CrunchbaseProperties } from '@/tools/crunchbase/types'
import {
  assertCollection,
  assertSingleCursor,
  CARD_LIMIT_MAX,
  CRUNCHBASE_API_BASE,
  CRUNCHBASE_CARD_COLLECTIONS,
  clampLimit,
  crunchbaseError,
  crunchbaseHeaders,
  parseIdListParam,
  readJson,
} from '@/tools/crunchbase/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig, ToolResponse } from '@/tools/types'

interface CrunchbaseGetEntityCardParams {
  apiKey: string
  collection: string
  entityId: string
  cardId: string
  cardFieldIds?: string[] | string
  cardOrder?: string
  limit?: number | string
  afterId?: string
  beforeId?: string
}

interface CrunchbaseGetEntityCardResponse extends ToolResponse {
  output: {
    items: CrunchbaseProperties[]
    properties: CrunchbaseProperties
    nextAfterId: string | null
  }
}

/**
 * Guarantees the page carries the field its cursor is read from.
 *
 * `nextAfterId` comes off the last item's `uuid` / `identifier.uuid`, so a caller
 * narrowing `card_field_ids` to, say, `["announced_on"]` would get a full page
 * and a null cursor — and a paging loop would stop after the first page with
 * rows still unread.
 */
function withCursorField(cardFieldIds: string[] | undefined): string[] | undefined {
  if (!cardFieldIds?.length) return cardFieldIds
  if (cardFieldIds.includes('identifier') || cardFieldIds.includes('uuid')) return cardFieldIds
  return [...cardFieldIds, 'identifier']
}

export const crunchbaseGetEntityCardTool: ToolConfig<
  CrunchbaseGetEntityCardParams,
  CrunchbaseGetEntityCardResponse
> = {
  id: 'crunchbase_get_entity_card',
  name: 'Crunchbase Get Entity Card',
  description:
    "Page through one related-entity card of a Crunchbase entity — an investor's investments, a company's founders, a round's investors — past the 100-item cap an inline card request returns.",
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
      required: true,
      visibility: 'user-or-llm',
      description:
        'Collection the entity belongs to. One of: acquisitions, addresses, categories, category_groups, degrees, event_appearances, events, funding_rounds, funds, investments, ipos, jobs, market_insights, micro_categories, organizations, ownerships, people.',
    },
    entityId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Entity permalink or UUID',
    },
    cardId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Card to page through, e.g. "participated_investments" on a person, "founders" on an organization, or "investors" on a funding round. Valid ids differ per collection.',
    },
    cardFieldIds: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Fields to return on each card item, e.g. ["identifier","announced_on","money_raised"]. The identifier is always requested alongside these, because the next-page cursor is read from it.',
    },
    cardOrder: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort expression for the card, e.g. "funding_round_money_raised desc"',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Card items to return per page, 1-100',
    },
    afterId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'UUID of the last card item on the current page, to fetch the next page',
    },
    beforeId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'UUID of the first card item on the current page, to fetch the previous page',
    },
  },

  request: {
    url: (params) => {
      const collection = assertCollection(
        params.collection,
        CRUNCHBASE_CARD_COLLECTIONS,
        'collection'
      )
      const entityId = params.entityId?.trim()
      if (!entityId) throw new Error('Crunchbase "entityId" (uuid or permalink) is required')
      const cardId = params.cardId?.trim()
      if (!cardId) throw new Error('Crunchbase "cardId" is required')

      assertSingleCursor(params.afterId, params.beforeId)

      const search = new URLSearchParams()
      const cardFieldIds = withCursorField(parseIdListParam(params.cardFieldIds, 'cardFieldIds'))
      if (cardFieldIds?.length) search.set('card_field_ids', cardFieldIds.join(','))
      if (params.cardOrder) search.set('order', params.cardOrder)
      const limit = clampLimit(params.limit, CARD_LIMIT_MAX)
      if (limit !== undefined) search.set('limit', String(limit))
      if (params.afterId) search.set('after_id', params.afterId)
      if (params.beforeId) search.set('before_id', params.beforeId)

      const qs = search.toString()
      return `${CRUNCHBASE_API_BASE}/entities/${collection}/${encodeURIComponent(entityId)}/cards/${encodeURIComponent(cardId)}${qs ? `?${qs}` : ''}`
    },
    method: 'GET',
    headers: (params) => crunchbaseHeaders(params.apiKey),
  },

  transformResponse: async (response, params) => {
    if (!response.ok) throw await crunchbaseError(response)

    const data = await readJson<{
      properties?: CrunchbaseProperties
      cards?: Record<string, unknown>
    }>(response)

    /* The endpoint answers with the entity wrapper, so the page sits under the
       requested card id rather than at the top level — keyed by the same trimmed
       id the URL used, or a pasted " founders " would read back as empty. */
    const card = data.cards?.[params?.cardId?.trim() ?? '']

    /* Every card this endpoint serves is typed as an array of entities. Wrapping
       a non-array as a single item would invent a one-row page out of a shape we
       do not understand, so an unexpected value reports as empty instead. */
    const items = Array.isArray(card) ? (card as CrunchbaseProperties[]) : []
    /* A card item carries its uuid at the top level only when `card_field_ids`
       asked for it; otherwise the identifier object is the one place it lives. */
    const last = items[items.length - 1]
    const identifier = last?.identifier as { uuid?: unknown } | undefined
    const lastUuid =
      typeof last?.uuid === 'string'
        ? last.uuid
        : typeof identifier?.uuid === 'string'
          ? identifier.uuid
          : null

    return {
      success: true,
      output: {
        items,
        properties: data.properties ?? {},
        nextAfterId: lastUuid,
      },
    }
  },

  outputs: {
    items: {
      type: 'json',
      description: 'Card items for this page, each holding the requested card_field_ids',
    },
    properties: {
      type: 'json',
      description: 'Properties of the parent entity returned alongside the card',
    },
    nextAfterId: {
      type: 'string',
      nullable: true,
      description: 'UUID of the last card item, to pass as afterId for the next page',
    },
  },
}
