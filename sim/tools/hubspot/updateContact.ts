// /sim/tools/hubspot/updateContact.ts
import { ToolConfig } from '../types'
import { UpdateContactParams, UpdateContactResponse } from './types'

export const updateContactTool: ToolConfig<UpdateContactParams, UpdateContactResponse> = {
  id: 'hubspot_update_contact',
  name: 'Update Contact',
  description: 'Update an existing contact',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'hubspot',
    additionalScopes: ['crm.objects.contacts.write'],
  },

  params: {
    accessToken: { type: 'string', required: true },
    contactId:   { type: 'string', required: true },
    properties:  { type: 'json',   required: true },
  },

  request: {
    url: params => `https://api.hubapi.com/crm/v3/objects/contacts/${params.contactId}`,
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

  transformError: error => `Updating contact failed: ${error?.message}`
}