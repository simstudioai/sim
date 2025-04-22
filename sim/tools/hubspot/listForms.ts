// /sim/tools/hubspot/listForms.ts
import { ToolConfig } from '../types'
import { ListFormsParams, ListFormsResponse } from './types'

export const listFormsTool: ToolConfig<ListFormsParams, ListFormsResponse> = {
  id: 'hubspot_list_forms',
  name: 'List Forms',
  description: 'Retrieve a paginated list of marketing forms',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'hubspot',
    additionalScopes: ['marketing.forms.read'],
  },

  params: {
    accessToken: { type: 'string', required: true },
    limit:       { type: 'number', required: false },
  },

  request: {
    url: params => {
      const lim = params.limit ?? 100
      return `https://api.hubapi.com/marketing/v3/forms?limit=${lim}`
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

  transformError: error => `Listing forms failed: ${error?.message}`
}