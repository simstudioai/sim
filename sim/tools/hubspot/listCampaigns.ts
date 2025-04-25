// /sim/tools/hubspot/listCampaigns.ts
import { ToolConfig } from '../types'
import { ListCampaignsParams, ListCampaignsResponse } from './types'

export const listCampaignsTool: ToolConfig<ListCampaignsParams, ListCampaignsResponse> = {
  id: 'hubspot_list_campaigns',
  name: 'List Campaigns',
  description: 'Retrieve a paginated list of marketing campaigns',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'hubspot',
    additionalScopes: ['marketing.campaigns.read'],
  },

  params: {
    accessToken: { type: 'string', required: true },
    limit: { type: 'number', required: false },
  },

  request: {
    url: params => `https://api.hubapi.com/marketing/v3/campaigns?limit=${params.limit ?? 100}`,
    method: 'GET',
    headers: params => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json'
    })
  },

  transformResponse: async response => {
    if (!response.ok) {
      const err = await response.text()
      throw new Error(`HTTP ${response.status}: ${err}`)
    }
    const data = await response.json()
    return { success: true, output: data }
  },

  transformError: error => `Listing campaigns failed: ${error?.message}`
}