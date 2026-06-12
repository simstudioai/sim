import type { BrexListCardsParams, BrexListCardsResponse } from '@/tools/brex/types'
import {
  appendBrexPagination,
  BREX_API_BASE,
  buildBrexHeaders,
  parseBrexJson,
} from '@/tools/brex/utils'
import type { ToolConfig } from '@/tools/types'

export const brexListCardsTool: ToolConfig<BrexListCardsParams, BrexListCardsResponse> = {
  id: 'brex_list_cards',
  name: 'Brex List Cards',
  description: 'List cards in the Brex account, optionally filtered by card owner',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Brex user token (generated from Developer Settings in the Brex dashboard)',
    },
    userId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter cards by the ID of the card owner',
    },
    cursor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination cursor from a previous response',
    },
    limit: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of cards to return (default 100, max 1000)',
    },
  },

  request: {
    url: (params) => {
      const query = new URLSearchParams()
      if (params.userId) query.append('user_id', params.userId.trim())
      appendBrexPagination(query, params)
      const queryString = query.toString()
      return queryString ? `${BREX_API_BASE}/v2/cards?${queryString}` : `${BREX_API_BASE}/v2/cards`
    },
    method: 'GET',
    headers: (params) => buildBrexHeaders(params.apiKey),
  },

  transformResponse: async (response) => {
    const data = await parseBrexJson(response)
    return {
      success: true,
      output: {
        items: data.items ?? [],
        nextCursor: data.next_cursor ?? null,
      },
    }
  },

  outputs: {
    items: {
      type: 'array',
      description: 'Cards in the Brex account',
      items: {
        type: 'json',
        properties: {
          id: { type: 'string', description: 'Unique card ID' },
          owner: { type: 'json', description: 'Card owner (type, user_id)' },
          status: { type: 'string', description: 'Card status', optional: true },
          last_four: { type: 'string', description: 'Last four digits of the card number' },
          card_name: { type: 'string', description: 'Card name' },
          card_type: {
            type: 'string',
            description: 'Card type (VIRTUAL or PHYSICAL)',
            optional: true,
          },
          limit_type: { type: 'string', description: 'Limit type (CARD or USER)' },
          spend_controls: {
            type: 'json',
            description: 'Spend controls on the card',
            optional: true,
          },
          billing_address: { type: 'json', description: 'Billing address of the card' },
          expiration_date: { type: 'json', description: 'Card expiration date (month, year)' },
          budget_id: { type: 'string', description: 'Associated budget ID', optional: true },
        },
      },
    },
    nextCursor: {
      type: 'string',
      description: 'Cursor for fetching the next page of results',
      optional: true,
    },
  },
}
