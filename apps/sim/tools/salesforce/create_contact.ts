import { createLogger } from '@sim/logger'
import type {
  SalesforceCreateContactParams,
  SalesforceCreateContactResponse,
} from '@/tools/salesforce/types'
import { getInstanceUrl } from '@/tools/salesforce/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('SalesforceContacts')

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
