// /sim/tools/hubspot/createContact.ts
import { ToolConfig } from '../types'
import { CreateContactParams, CreateContactResponse } from './types'

export const createContactTool: ToolConfig<CreateContactParams, CreateContactResponse> = {
  id: 'hubspot_create_contact',
  name: 'Create Contact',
  description: 'Create a new contact in HubSpot',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'hubspot',
    additionalScopes: ['crm.objects.contacts.write'],
  },

  params: {
    accessToken: { type: 'string', required: true },
    properties: { type: 'json',   required: true },
  },

  request: {
    url: () => `https://api.hubapi.com/crm/v3/objects/contacts`,
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

  transformError: error => `Creating contact failed: ${error?.message}`
}