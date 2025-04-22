// /sim/tools/hubspot/createDeal.ts
import { ToolConfig } from '../types'
import { CreateDealParams, CreateDealResponse } from './types'

export const createDealTool: ToolConfig<CreateDealParams, CreateDealResponse> = {
  id: 'hubspot_create_deal',
  name: 'Create Deal',
  description: 'Create a new deal in HubSpot',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'hubspot',
    additionalScopes: ['crm.objects.deals.write'],
  },

  params: {
    accessToken: { type: 'string', required: true },
    properties:  { type: 'json',   required: true },
  },

  request: {
    url: () => `https://api.hubapi.com/crm/v3/objects/deals`,
    method: 'POST',
    headers: params => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json'
    }),
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

  transformError: error => `Creating deal failed: ${error?.message}`
}