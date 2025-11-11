import { createLogger } from '@/lib/logs/console/logger'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('SalesforceContacts')

// Helper to extract instance URL from idToken
function getInstanceUrl(idToken?: string, instanceUrl?: string): string {
  if (instanceUrl) return instanceUrl

  if (idToken) {
    try {
      const base64Url = idToken.split('.')[1]
      const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/')
      const jsonPayload = decodeURIComponent(
        atob(base64)
          .split('')
          .map((c) => `%${(`00${c.charCodeAt(0).toString(16)}`).slice(-2)}`)
          .join('')
      )
      const decoded = JSON.parse(jsonPayload)

      if (decoded.profile) {
        const match = decoded.profile.match(/^(https:\/\/[^/]+)/)
        if (match) return match[1]
      } else if (decoded.sub) {
        const match = decoded.sub.match(/^(https:\/\/[^/]+)/)
        if (match && match[1] !== 'https://login.salesforce.com') {
          return match[1]
        }
      }
    } catch (error) {
      logger.error('Failed to decode Salesforce idToken', { error })
    }
  }

  throw new Error('Salesforce instance URL is required but not provided')
}

// Get Contacts (with optional contactId)
export interface SalesforceGetContactsParams {
  accessToken: string
  idToken?: string
  instanceUrl?: string
  contactId?: string
  limit?: string
  fields?: string
  orderBy?: string
}

export interface SalesforceGetContactsResponse {
  success: boolean
  output: {
    contacts?: any[]
    contact?: any
    paging?: {
      nextRecordsUrl?: string
      totalSize: number
      done: boolean
    }
    metadata: {
      operation: 'get_contacts'
      totalReturned?: number
      hasMore?: boolean
      singleContact?: boolean
    }
    success: boolean
  }
}

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

  transformResponse: async (response: Response, params) => {
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

// Create Contact
export interface SalesforceCreateContactParams {
  accessToken: string
  idToken?: string
  instanceUrl?: string
  lastName: string
  firstName?: string
  email?: string
  phone?: string
  accountId?: string
  title?: string
  department?: string
  mailingStreet?: string
  mailingCity?: string
  mailingState?: string
  mailingPostalCode?: string
  mailingCountry?: string
  description?: string
}

export interface SalesforceCreateContactResponse {
  success: boolean
  output: {
    id: string
    success: boolean
    created: boolean
    metadata: { operation: 'create_contact' }
  }
}

export const salesforceCreateContactTool: ToolConfig<
  SalesforceCreateContactParams,
  SalesforceCreateContactResponse
> = {
  id: 'salesforce_create_contact',
  name: 'Create Contact in Salesforce',
  description: 'Create a new contact in Salesforce CRM',
  version: '1.0.0',

  oauth: { required: true, provider: 'salesforce' },

  params: {
    accessToken: { type: 'string', required: true, visibility: 'hidden' },
    idToken: { type: 'string', required: false, visibility: 'hidden' },
    instanceUrl: { type: 'string', required: false, visibility: 'hidden' },
    lastName: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Last name (required)',
    },
    firstName: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'First name',
    },
    email: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Email address',
    },
    phone: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Phone number',
    },
    accountId: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Account ID to associate contact with',
    },
    title: { type: 'string', required: false, visibility: 'user-only', description: 'Job title' },
    department: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Department',
    },
    mailingStreet: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Mailing street',
    },
    mailingCity: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Mailing city',
    },
    mailingState: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Mailing state',
    },
    mailingPostalCode: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Mailing postal code',
    },
    mailingCountry: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Mailing country',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Contact description',
    },
  },

  request: {
    url: (params) => {
      const instanceUrl = getInstanceUrl(params.idToken, params.instanceUrl)
      return `${instanceUrl}/services/data/v59.0/sobjects/Contact`
    },
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, any> = { LastName: params.lastName }

      if (params.firstName) body.FirstName = params.firstName
      if (params.email) body.Email = params.email
      if (params.phone) body.Phone = params.phone
      if (params.accountId) body.AccountId = params.accountId
      if (params.title) body.Title = params.title
      if (params.department) body.Department = params.department
      if (params.mailingStreet) body.MailingStreet = params.mailingStreet
      if (params.mailingCity) body.MailingCity = params.mailingCity
      if (params.mailingState) body.MailingState = params.mailingState
      if (params.mailingPostalCode) body.MailingPostalCode = params.mailingPostalCode
      if (params.mailingCountry) body.MailingCountry = params.mailingCountry
      if (params.description) body.Description = params.description

      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      logger.error('Salesforce API request failed', { data, status: response.status })
      throw new Error(data[0]?.message || data.message || 'Failed to create contact in Salesforce')
    }

    return {
      success: true,
      output: {
        id: data.id,
        success: data.success,
        created: true,
        metadata: { operation: 'create_contact' as const },
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Created contact data',
      properties: {
        id: { type: 'string', description: 'Created contact ID' },
        success: { type: 'boolean', description: 'Salesforce operation success' },
        created: { type: 'boolean', description: 'Whether contact was created' },
        metadata: { type: 'object', description: 'Operation metadata' },
      },
    },
  },
}

// Update Contact
export interface SalesforceUpdateContactParams {
  accessToken: string
  idToken?: string
  instanceUrl?: string
  contactId: string
  lastName?: string
  firstName?: string
  email?: string
  phone?: string
  accountId?: string
  title?: string
  department?: string
  mailingStreet?: string
  mailingCity?: string
  mailingState?: string
  mailingPostalCode?: string
  mailingCountry?: string
  description?: string
}

export interface SalesforceUpdateContactResponse {
  success: boolean
  output: {
    id: string
    updated: boolean
    metadata: { operation: 'update_contact' }
  }
}

export const salesforceUpdateContactTool: ToolConfig<
  SalesforceUpdateContactParams,
  SalesforceUpdateContactResponse
> = {
  id: 'salesforce_update_contact',
  name: 'Update Contact in Salesforce',
  description: 'Update an existing contact in Salesforce CRM',
  version: '1.0.0',

  oauth: { required: true, provider: 'salesforce' },

  params: {
    accessToken: { type: 'string', required: true, visibility: 'hidden' },
    idToken: { type: 'string', required: false, visibility: 'hidden' },
    instanceUrl: { type: 'string', required: false, visibility: 'hidden' },
    contactId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Contact ID to update (required)',
    },
    lastName: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Last name',
    },
    firstName: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'First name',
    },
    email: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Email address',
    },
    phone: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Phone number',
    },
    accountId: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Account ID to associate with',
    },
    title: { type: 'string', required: false, visibility: 'user-only', description: 'Job title' },
    department: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Department',
    },
    mailingStreet: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Mailing street',
    },
    mailingCity: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Mailing city',
    },
    mailingState: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Mailing state',
    },
    mailingPostalCode: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Mailing postal code',
    },
    mailingCountry: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Mailing country',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Description',
    },
  },

  request: {
    url: (params) => {
      const instanceUrl = getInstanceUrl(params.idToken, params.instanceUrl)
      return `${instanceUrl}/services/data/v59.0/sobjects/Contact/${params.contactId}`
    },
    method: 'PATCH',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, any> = {}

      if (params.lastName) body.LastName = params.lastName
      if (params.firstName) body.FirstName = params.firstName
      if (params.email) body.Email = params.email
      if (params.phone) body.Phone = params.phone
      if (params.accountId) body.AccountId = params.accountId
      if (params.title) body.Title = params.title
      if (params.department) body.Department = params.department
      if (params.mailingStreet) body.MailingStreet = params.mailingStreet
      if (params.mailingCity) body.MailingCity = params.mailingCity
      if (params.mailingState) body.MailingState = params.mailingState
      if (params.mailingPostalCode) body.MailingPostalCode = params.mailingPostalCode
      if (params.mailingCountry) body.MailingCountry = params.mailingCountry
      if (params.description) body.Description = params.description

      return body
    },
  },

  transformResponse: async (response: Response, params) => {
    if (!response.ok) {
      const data = await response.json()
      logger.error('Salesforce API request failed', { data, status: response.status })
      throw new Error(data[0]?.message || data.message || 'Failed to update contact in Salesforce')
    }

    return {
      success: true,
      output: {
        id: params?.contactId || '',
        updated: true,
        metadata: { operation: 'update_contact' as const },
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Updated contact data',
      properties: {
        id: { type: 'string', description: 'Updated contact ID' },
        updated: { type: 'boolean', description: 'Whether contact was updated' },
        metadata: { type: 'object', description: 'Operation metadata' },
      },
    },
  },
}

// Delete Contact
export interface SalesforceDeleteContactParams {
  accessToken: string
  idToken?: string
  instanceUrl?: string
  contactId: string
}

export interface SalesforceDeleteContactResponse {
  success: boolean
  output: {
    id: string
    deleted: boolean
    metadata: { operation: 'delete_contact' }
  }
}

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
      visibility: 'user-only',
      description: 'Contact ID to delete (required)',
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

  transformResponse: async (response: Response, params) => {
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
        metadata: { operation: 'delete_contact' as const },
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Deleted contact data',
      properties: {
        id: { type: 'string', description: 'Deleted contact ID' },
        deleted: { type: 'boolean', description: 'Whether contact was deleted' },
        metadata: { type: 'object', description: 'Operation metadata' },
      },
    },
  },
}
