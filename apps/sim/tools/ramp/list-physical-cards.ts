import type { RampListPhysicalCardsParams, RampListPhysicalCardsResponse } from '@/tools/ramp/types'
import { RAMP_PHYSICAL_CARD_PROPERTIES } from '@/tools/ramp/types'
import {
  appendRampPagination,
  buildRampHeaders,
  getRampPagination,
  parseRampResponse,
  projectPhysicalCard,
} from '@/tools/ramp/utils'
import type { ToolConfig } from '@/tools/types'

export const rampListPhysicalCardsTool: ToolConfig<
  RampListPhysicalCardsParams,
  RampListPhysicalCardsResponse
> = {
  id: 'ramp_list_physical_cards',
  name: 'Ramp List Physical Cards',
  description: 'List physical cards in one page in Ramp',
  version: '1.0.0',
  oauth: { required: true, provider: 'ramp' },
  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Ramp OAuth access token',
    },
    user_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by card owner.',
    },
    display_name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by display name.',
    },
    start: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Next cursor from the previous response',
    },
    page_size: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Results per page, from 2 to 100 (default 20)',
    },
  },
  request: {
    url: (params) => {
      const query = new URLSearchParams()
      appendRampPagination(query, params)
      if (params.user_id) query.set('user_id', params.user_id.trim())
      if (params.display_name) query.set('display_name', params.display_name.trim())
      return `https://api.ramp.com/developer/v1/cards/physical?${query}`
    },
    method: 'GET',
    headers: (params) => buildRampHeaders(params.accessToken),
  },
  transformResponse: async (response) => {
    const data = await parseRampResponse(response)
    if (!Array.isArray(data.data)) throw new Error('Ramp returned an invalid list response')
    if (data.data.length > 100) throw new Error('Ramp returned more than 100 results in one page')
    return {
      success: true,
      output: { physicalCards: data.data.map(projectPhysicalCard), ...getRampPagination(data) },
    }
  },
  outputs: {
    physicalCards: {
      type: 'array',
      description: 'One page of physical cards',
      items: { type: 'object', properties: RAMP_PHYSICAL_CARD_PROPERTIES },
    },
    nextCursor: {
      type: 'string',
      description: 'Pass this cursor as start to fetch the next page',
      optional: true,
    },
    nextPageUrl: {
      type: 'string',
      description: 'Ramp URL for the next page, or null on the last page',
      optional: true,
    },
  },
}
