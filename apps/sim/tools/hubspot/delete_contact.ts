import { createLogger } from '@sim/logger'
import type {
  HubSpotDeleteContactParams,
  HubSpotDeleteContactResponse,
} from '@/tools/hubspot/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('HubSpotDeleteContact')

export const hubspotDeleteContactTool: ToolConfig<
  HubSpotDeleteContactParams,
  HubSpotDeleteContactResponse
> = {
  id: 'hubspot_delete_contact',
  name: 'Delete Contact from HubSpot',
  description: 'Archive a contact in HubSpot by ID (moves it to the recycling bin)',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'hubspot',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'The access token for the HubSpot API',
    },
    contactId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The numeric ID of the contact to delete',
    },
  },

  request: {
    url: (params) => `https://api.hubapi.com/crm/v3/objects/contacts/${params.contactId.trim()}`,
    method: 'DELETE',
    headers: (params) => {
      if (!params.accessToken) {
        throw new Error('Access token is required')
      }
      return {
        Authorization: `Bearer ${params.accessToken}`,
      }
    },
  },

  transformResponse: async (response: Response, params) => {
    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      logger.error('HubSpot API request failed', { data, status: response.status })
      throw new Error(data.message || 'Failed to delete contact from HubSpot')
    }
    return {
      success: true,
      output: {
        contactId: params?.contactId ?? '',
        deleted: true,
        success: true,
      },
    }
  },

  outputs: {
    contactId: { type: 'string', description: 'ID of the deleted contact' },
    deleted: { type: 'boolean', description: 'Whether the contact was archived' },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
