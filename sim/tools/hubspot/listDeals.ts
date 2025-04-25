// /sim/tools/hubspot/listDeals.ts
import { ToolConfig } from '../types'
import { ListDealsParams, ListDealsResponse } from './types'

export const listDealsTool: ToolConfig<ListDealsParams, ListDealsResponse> = {
  id: 'hubspot_list_deals',
  name: 'List Deals',
  description: 'Retrieve a paginated list of deals',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'hubspot',
    additionalScopes: ['crm.objects.deals.read'],
  },

  params: {
    accessToken: { type: 'string', required: true },
    limit: { type: 'number', required: false },
  },

  request: {
    url: params => {
      const lim = params.limit ?? 100
      return `https://api.hubapi.com/crm/v3/objects/deals?limit=${lim}`
    },
    method: 'GET',
    headers: params => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async response => {
    if (!response.ok) {
      const err = await response.text()
      throw new Error(`HTTP ${response.status}: ${err}`)
    }
    const data = await response.json()
    return { success: true, output: data }
  },

  transformError: error => `Listing deals failed: ${error?.message}`
}