import { createLogger } from '@sim/logger'
import type {
  SalesforceDeleteContactParams,
  SalesforceDeleteContactResponse,
} from '@/tools/salesforce/types'
import { SOBJECT_DELETE_OUTPUT_PROPERTIES } from '@/tools/salesforce/types'
import { getInstanceUrl } from '@/tools/salesforce/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('SalesforceContacts')

export const salesforceDeleteContactTool: ToolConfig<
  SalesforceDeleteContactParams,
  SalesforceDeleteContactResponse
> = {
  id: 'salesforce_delete_contact',
  name: 'Delete Contact from Salesforce',
  description: 'Delete a contact from Salesforce CRM',
  version: '1.0.0',

  oauth: { required: true, provider: 'salesforce' },

  params: {
    accessToken: { type: 'string', required: true, visibility: 'hidden' },
    idToken: { type: 'string', required: false, visibility: 'hidden' },
    instanceUrl: { type: 'string', required: false, visibility: 'hidden' },
    contactId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Salesforce Contact ID to delete (18-character string starting with 003)',
    },
  },

  request: {
    url: (params) => {
      const instanceUrl = getInstanceUrl(params.idToken, params.instanceUrl)
      return `${instanceUrl}/services/data/v59.0/sobjects/Contact/${params.contactId}`
    },
    method: 'DELETE',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },

  transformResponse: async (response: Response, params?) => {
    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      logger.error('Salesforce API request failed', { data, status: response.status })
      throw new Error(
        data[0]?.message || data.message || 'Failed to delete contact from Salesforce'
      )
    }

    return {
      success: true,
      output: {
        id: params?.contactId || '',
        deleted: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Deleted contact data',
      properties: SOBJECT_DELETE_OUTPUT_PROPERTIES,
    },
  },
}
