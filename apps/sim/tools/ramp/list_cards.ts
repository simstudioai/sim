import type { RampListCardsParams, RampListCardsResponse } from '@/tools/ramp/types'
import {
  buildRampHeaders,
  buildRampUrl,
  extractNextStart,
  extractRampError,
} from '@/tools/ramp/utils'
import type { ToolConfig } from '@/tools/types'

export const rampListCardsTool: ToolConfig<RampListCardsParams, RampListCardsResponse> = {
  id: 'ramp_list_cards',
  name: 'Ramp List Cards',
  description: 'List corporate cards in Ramp with optional filters',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'ramp',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'OAuth access token for the Ramp API',
    },
    userId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter cards by cardholder user ID',
    },
    displayName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter cards by display name',
    },
    pageSize: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of results per page (between 2 and 100, default 20)',
    },
    start: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination cursor: the ID of the last entity from the previous page',
    },
  },

  request: {
    url: (params) =>
      buildRampUrl('/cards', {
        user_id: params.userId,
        display_name: params.displayName,
        page_size: params.pageSize,
        start: params.start,
      }),
    method: 'GET',
    headers: (params) => buildRampHeaders(params),
  },

  transformResponse: async (response): Promise<RampListCardsResponse> => {
    const data = await response.json()

    if (!response.ok) {
      return {
        success: false,
        error: extractRampError(data, 'Failed to list Ramp cards'),
        output: {},
      }
    }

    return {
      success: true,
      output: {
        cards: data.data ?? [],
        nextStart: extractNextStart(data.page?.next),
      },
    }
  },

  outputs: {
    cards: {
      type: 'array',
      description: 'List of Ramp corporate cards',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Unique identifier for the card' },
          display_name: { type: 'string', description: 'Display name of the card' },
          last_four: { type: 'string', description: 'Last four digits of the card number' },
          cardholder_id: { type: 'string', description: 'User ID of the cardholder' },
          cardholder_name: { type: 'string', description: 'Full name of the cardholder' },
          is_physical: { type: 'boolean', description: 'Whether the card is physical' },
          state: { type: 'string', description: 'State of the card (e.g. ACTIVE)' },
          expiration: { type: 'string', description: 'Expiration date of the card' },
        },
      },
    },
    nextStart: {
      type: 'string',
      description: 'Cursor for the next page of results (null when there are no more pages)',
      optional: true,
    },
  },
}
