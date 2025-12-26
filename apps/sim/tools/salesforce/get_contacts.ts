import { createLogger } from '@sim/logger'
import type {
  SalesforceGetContactsParams,
  SalesforceGetContactsResponse,
} from '@/tools/salesforce/types'
import { getInstanceUrl } from '@/tools/salesforce/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('SalesforceContacts')

export const salesforceGetContactsTool: ToolConfig<
  SalesforceGetContactsParams,
  SalesforceGetContactsResponse
> = {
  id: 'salesforce_get_contacts',
  name: 'Get Contacts from Salesforce',
  description: 'Get contact(s) from Salesforce - single contact if ID provided, or list if not',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'salesforce',
  },

  params: {
    accessToken: { type: 'string', required: true, visibility: 'hidden' },
    idToken: { type: 'string', required: false, visibility: 'hidden' },
    instanceUrl: { type: 'string', required: false, visibility: 'hidden' },
    contactId: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Contact ID (if provided, returns single contact)',
    },
    limit: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Number of results (default: 100, max: 2000). Only for list query.',
    },
    fields: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Comma-separated fields (e.g., "Id,FirstName,LastName,Email,Phone")',
    },
    orderBy: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Order by field (e.g., "LastName ASC"). Only for list query.',
    },
  },

  request: {
    url: (params) => {
      const instanceUrl = getInstanceUrl(params.idToken, params.instanceUrl)

      // Single contact by ID
      if (params.contactId) {
        const fields =
          params.fields || 'Id,FirstName,LastName,Email,Phone,AccountId,Title,Department'
        return `${instanceUrl}/services/data/v59.0/sobjects/Contact/${params.contactId}?fields=${fields}`
      }

      // List contacts with SOQL query
      const limit = params.limit ? Number.parseInt(params.limit) : 100
      const fields = params.fields || 'Id,FirstName,LastName,Email,Phone,AccountId,Title,Department'
      const orderBy = params.orderBy || 'LastName ASC'
      const query = `SELECT ${fields} FROM Contact ORDER BY ${orderBy} LIMIT ${limit}`
      const encodedQuery = encodeURIComponent(query)

      return `${instanceUrl}/services/data/v59.0/query?q=${encodedQuery}`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response, params?) => {
    const data = await response.json()

    if (!response.ok) {
      logger.error('Salesforce API request failed', { data, status: response.status })
      throw new Error(
        data[0]?.message || data.message || 'Failed to fetch contacts from Salesforce'
      )
    }

    // Single contact response
    if (params?.contactId) {
      return {
        success: true,
        output: {
          contact: data,
          metadata: {
            operation: 'get_contacts' as const,
            singleContact: true,
          },
          success: true,
        },
      }
    }

    // List contacts response
    const contacts = data.records || []
    return {
      success: true,
      output: {
        contacts,
        paging: {
          nextRecordsUrl: data.nextRecordsUrl,
          totalSize: data.totalSize || contacts.length,
          done: data.done !== false,
        },
        metadata: {
          operation: 'get_contacts' as const,
          totalReturned: contacts.length,
          hasMore: !data.done,
          singleContact: false,
        },
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Contact(s) data',
      properties: {
        contacts: { type: 'array', description: 'Array of contacts (list query)' },
        contact: { type: 'object', description: 'Single contact (by ID)' },
        paging: { type: 'object', description: 'Pagination info (list query)' },
        metadata: { type: 'object', description: 'Operation metadata' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
