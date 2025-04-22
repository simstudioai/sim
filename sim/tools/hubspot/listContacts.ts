// /sim/tools/hubspot/listContacts.ts
import { ToolConfig } from '../types'
import { ListContactsParams, ListContactsResponse } from './types'

export const listContactsTool: ToolConfig<ListContactsParams, ListContactsResponse> = {
  id: 'hubspot_list_contacts',
  name: 'List Contacts',
  description: 'Retrieve a paginated list of contacts',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'hubspot',
    additionalScopes: ['crm.objects.contacts.read'],
  },

  params: {
    accessToken: { type: 'string', required: true },
    limit:        { type: 'number', required: false },
  },

  request: {
    url: params => {
      const lim = params.limit ?? 100
      return `https://api.hubapi.com/crm/v3/objects/contacts?limit=${lim}`
    },
    method: 'GET',
    headers: () => ({})
  },

  transformResponse: async response => {
    if (!response.ok) {
      const err = await response.text()
      throw new Error(`HTTP ${response.status}: ${err}`)
    }
    const data = await response.json()
    return { success: true, output: data }
  },

  transformError: error => `Listing contacts failed: ${error?.message}`
}