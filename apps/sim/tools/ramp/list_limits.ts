import type { RampListLimitsParams, RampListLimitsResponse } from '@/tools/ramp/types'
import {
  buildRampHeaders,
  buildRampUrl,
  extractNextStart,
  extractRampError,
} from '@/tools/ramp/utils'
import type { ToolConfig } from '@/tools/types'

export const rampListLimitsTool: ToolConfig<RampListLimitsParams, RampListLimitsResponse> = {
  id: 'ramp_list_limits',
  name: 'Ramp List Limits',
  description: 'List spend limits in Ramp with optional filters',
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
      description: 'Filter limits by user ID',
    },
    cardId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter limits by card ID',
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
      buildRampUrl('/limits', {
        user_id: params.userId,
        card_id: params.cardId,
        page_size: params.pageSize,
        start: params.start,
      }),
    method: 'GET',
    headers: (params) => buildRampHeaders(params),
  },

  transformResponse: async (response): Promise<RampListLimitsResponse> => {
    const data = await response.json()

    if (!response.ok) {
      return {
        success: false,
        error: extractRampError(data, 'Failed to list Ramp limits'),
        output: {},
      }
    }

    return {
      success: true,
      output: {
        limits: data.data ?? [],
        nextStart: extractNextStart(data.page?.next),
      },
    }
  },

  outputs: {
    limits: {
      type: 'array',
      description: 'List of Ramp spend limits',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Unique identifier for the spend limit' },
          display_name: { type: 'string', description: 'Display name of the spend limit' },
          state: { type: 'string', description: 'State of the spend limit (e.g. ACTIVE)' },
          balance: {
            type: 'object',
            description:
              'Balance of the spend limit (cleared, pending, and total canonical amounts in the smallest currency denomination)',
          },
          users: { type: 'array', description: 'Users the spend limit applies to' },
          cards: { type: 'array', description: 'Cards attached to the spend limit' },
          spend_program_id: { type: 'string', description: 'ID of the associated spend program' },
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
