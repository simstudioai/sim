// /sim/tools/hubspot/searchContacts.ts
import { ToolConfig } from '../types'
import { SearchContactsParams, SearchContactsResponse } from './types'

export const searchContactsTool: ToolConfig<SearchContactsParams, SearchContactsResponse> = {
  id: 'hubspot_search_contacts',
  name: 'Search Contacts',
  description: 'Search contacts by filter groups',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'hubspot',
    additionalScopes: ['crm.objects.contacts.read'],
  },

  params: {
    accessToken:  { type: 'string', required: true },
    filterGroups: { type: 'json',   required: true },
    sorts:        { type: 'array',  required: false },
    limit:        { type: 'number', required: false },
  },

  request: {
    url: () => `https://api.hubapi.com/crm/v3/objects/contacts/search`,
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

  transformError: error => `Searching contacts failed: ${error?.message}`
}