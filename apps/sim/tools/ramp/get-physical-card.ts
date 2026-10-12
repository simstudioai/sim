import type { RampGetPhysicalCardParams, RampGetPhysicalCardResponse } from '@/tools/ramp/types'
import { RAMP_PHYSICAL_CARD_PROPERTIES } from '@/tools/ramp/types'
import { buildRampHeaders, parseRampResponse, projectPhysicalCard } from '@/tools/ramp/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const rampGetPhysicalCardTool: ToolConfig<
  RampGetPhysicalCardParams,
  RampGetPhysicalCardResponse
> = {
  id: 'ramp_get_physical_card',
  name: 'Ramp Get Physical Card',
  description: 'Fetch a physical card in Ramp',
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
      `https://api.ramp.com/developer/v1/cards/physical/${safeUrlPathSegment(params.card_id, 'card_id')}`,
    method: 'GET',
    headers: (params) => buildRampHeaders(params.accessToken),
  },
  transformResponse: async (response) => {
    const data = await parseRampResponse(response)
    return { success: true, output: { physicalCard: projectPhysicalCard(data) } }
  },
  outputs: {
    physicalCard: {
      type: 'json',
      description: 'PhysicalCard details',
      properties: RAMP_PHYSICAL_CARD_PROPERTIES,
    },
  },
}
