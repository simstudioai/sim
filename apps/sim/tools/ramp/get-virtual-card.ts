import type { RampGetVirtualCardParams, RampGetVirtualCardResponse } from '@/tools/ramp/types'
import { RAMP_VIRTUAL_CARD_PROPERTIES } from '@/tools/ramp/types'
import { buildRampHeaders, parseRampResponse, projectVirtualCard } from '@/tools/ramp/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const rampGetVirtualCardTool: ToolConfig<
  RampGetVirtualCardParams,
  RampGetVirtualCardResponse
> = {
  id: 'ramp_get_virtual_card',
  name: 'Ramp Get Virtual Card',
  description: 'Fetch a virtual card in Ramp',
  version: '1.0.0',
  oauth: { required: true, provider: 'ramp' },
  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Ramp OAuth access token',
    },
    card_id: { type: 'string', required: true, visibility: 'user-or-llm', description: 'Card id' },
  },
  request: {
    url: (params) =>
      `https://api.ramp.com/developer/v1/cards/virtual/${safeUrlPathSegment(params.card_id, 'card_id')}`,
    method: 'GET',
    headers: (params) => buildRampHeaders(params.accessToken),
  },
  transformResponse: async (response) => {
    const data = await parseRampResponse(response)
    return { success: true, output: { virtualCard: projectVirtualCard(data) } }
  },
  outputs: {
    virtualCard: {
      type: 'json',
      description: 'VirtualCard details',
      properties: RAMP_VIRTUAL_CARD_PROPERTIES,
    },
  },
}
