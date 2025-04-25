// /sim/tools/hubspot/listEmails.ts
import { ToolConfig } from '../types'
import { ListEmailsParams, ListEmailsResponse } from './types'

export const listEmailsTool: ToolConfig<ListEmailsParams, ListEmailsResponse> = {
  id: 'hubspot_list_emails',
  name: 'List Emails',
  description: 'Retrieve a paginated list of marketing emails',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'hubspot',
    additionalScopes: ['crm.objects.contacts.read'],
  },

  params: {
    accessToken: { type: 'string', required: true },
    limit:       { type: 'number', required: false },
  },

  request: {
    url: params => `https://api.hubapi.com/marketing/v3/emails?limit=${params.limit ?? 100}`,
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

  transformError: error => `Listing emails failed: ${error?.message}`
}