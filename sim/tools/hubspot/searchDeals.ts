// /sim/tools/hubspot/searchDeals.ts
import { ToolConfig } from '../types'
import { SearchDealsParams, SearchDealsResponse } from './types'

export const searchDealsTool: ToolConfig<SearchDealsParams, SearchDealsResponse> = {
  id: 'hubspot_search_deals',
  name: 'Search Deals',
  description: 'Search deals using filter groups',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'hubspot',
    additionalScopes: ['crm.objects.deals.read'],
  },

  params: {
    accessToken:  { type: 'string', required: true },
    filterGroups: { type: 'json',   required: true },
    sorts:        { type: 'array',  required: false },
    limit:        { type: 'number', required: false },
  },

  request: {
    url: () => `https://api.hubapi.com/crm/v3/objects/deals/search`,
    method: 'POST',
    headers: () => ({}),
    body: params => ({
      filterGroups: params.filterGroups,
      sorts:        params.sorts,
      limit:        params.limit
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

  transformError: error => `Searching deals failed: ${error?.message}`
}