import type { AshbyOffer } from '@/tools/ashby/types'
import { mapOffer, OFFER_OUTPUTS } from '@/tools/ashby/utils'
import type { ToolConfig, ToolResponse } from '@/tools/types'

interface AshbyGetOfferParams {
  apiKey: string
  offerId: string
}

interface AshbyGetOfferResponse extends ToolResponse {
  output: AshbyOffer
}

export const getOfferTool: ToolConfig<AshbyGetOfferParams, AshbyGetOfferResponse> = {
  id: 'ashby_get_offer',
  name: 'Ashby Get Offer',
  description: 'Retrieves full details about a single offer by its ID.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Ashby API Key',
    },
    offerId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The UUID of the offer to fetch',
    },
  },

  request: {
    url: 'https://api.ashbyhq.com/offer.info',
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Basic ${btoa(`${params.apiKey}:`)}`,
    }),
    body: (params) => ({
      offerId: params.offerId.trim(),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.success) {
      throw new Error(data.errorInfo?.message || 'Failed to get offer')
    }

    return {
      success: true,
      output: mapOffer(data.results),
    }
  },

  outputs: OFFER_OUTPUTS,
}
