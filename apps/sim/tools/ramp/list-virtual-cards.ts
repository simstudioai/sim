import type { RampListVirtualCardsParams, RampListVirtualCardsResponse } from '@/tools/ramp/types'
import { RAMP_VIRTUAL_CARD_PROPERTIES } from '@/tools/ramp/types'
import {
  appendRampPagination,
  buildRampHeaders,
  getRampPagination,
  parseRampResponse,
  projectVirtualCard,
} from '@/tools/ramp/utils'
import type { ToolConfig } from '@/tools/types'

export const rampListVirtualCardsTool: ToolConfig<
  RampListVirtualCardsParams,
  RampListVirtualCardsResponse
> = {
  id: 'ramp_list_virtual_cards',
  name: 'Ramp List Virtual Cards',
  description: 'List virtual cards in one page in Ramp',
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
    entity_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by business entity.',
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
      if (params.entity_id) query.set('entity_id', params.entity_id.trim())
      return `https://api.ramp.com/developer/v1/cards/virtual?${query}`
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
      output: { virtualCards: data.data.map(projectVirtualCard), ...getRampPagination(data) },
    }
  },
  outputs: {
    virtualCards: {
      type: 'array',
      description: 'One page of virtual cards',
      items: { type: 'object', properties: RAMP_VIRTUAL_CARD_PROPERTIES },
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
