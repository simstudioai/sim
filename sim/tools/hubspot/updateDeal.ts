// /sim/tools/hubspot/updateDeal.ts
import { ToolConfig } from '../types'
import { UpdateDealParams, UpdateDealResponse } from './types'

export const updateDealTool: ToolConfig<UpdateDealParams, UpdateDealResponse> = {
  id: 'hubspot_update_deal',
  name: 'Update Deal',
  description: 'Update an existing deal',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'hubspot',
    additionalScopes: ['crm.objects.deals.write'],
  },

  params: {
    accessToken: { type: 'string', required: true },
    dealId:      { type: 'string', required: true },
    properties:  { type: 'json',   required: true },
  },

  request: {
    url: params => `https://api.hubapi.com/crm/v3/objects/deals/${params.dealId}`,
    method: 'PATCH',
    headers: () => ({}),
    body: params => ({ properties: params.properties })
  },

  transformResponse: async response => {
    if (!response.ok) {
      const err = await response.text()
      throw new Error(`HTTP ${response.status}: ${err}`)
    }
    const data = await response.json()
    return { success: true, output: data }
  },

  transformError: error => `Updating deal failed: ${error?.message}`
}