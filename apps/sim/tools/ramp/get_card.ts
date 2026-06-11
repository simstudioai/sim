import type { RampGetCardParams, RampGetCardResponse } from '@/tools/ramp/types'
import { buildRampHeaders, buildRampUrl, extractRampError } from '@/tools/ramp/utils'
import type { ToolConfig } from '@/tools/types'

export const rampGetCardTool: ToolConfig<RampGetCardParams, RampGetCardResponse> = {
  id: 'ramp_get_card',
  name: 'Ramp Get Card',
  description: 'Retrieve a single Ramp corporate card by ID',
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
    cardId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the card to retrieve',
    },
  },

  request: {
    url: (params) => buildRampUrl(`/cards/${encodeURIComponent(params.cardId.trim())}`),
    method: 'GET',
    headers: (params) => buildRampHeaders(params),
  },

  transformResponse: async (response): Promise<RampGetCardResponse> => {
    const data = await response.json()

    if (!response.ok) {
      return {
        success: false,
        error: extractRampError(data, 'Failed to get Ramp card'),
        output: {},
      }
    }

    return {
      success: true,
      output: {
        card: data,
      },
    }
  },

  outputs: {
    card: {
      type: 'object',
      description: 'The requested Ramp card',
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
}
