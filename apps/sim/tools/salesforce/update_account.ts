import type {
  SalesforceUpdateAccountParams,
  SalesforceUpdateAccountResponse,
} from '@/tools/salesforce/types'
import { SOBJECT_UPDATE_OUTPUT_PROPERTIES } from '@/tools/salesforce/types'
import { extractErrorMessage, getInstanceUrl, requireId } from '@/tools/salesforce/utils'
import type { ToolConfig } from '@/tools/types'

export const salesforceUpdateAccountTool: ToolConfig<
  SalesforceUpdateAccountParams,
  SalesforceUpdateAccountResponse
> = {
  id: 'salesforce_update_account',
  name: 'Update Account in Salesforce',
  description: 'Update an existing account in Salesforce CRM',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'salesforce',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
    },
    idToken: {
      type: 'string',
      required: false,
      visibility: 'hidden',
    },
    instanceUrl: {
      type: 'string',
      required: false,
      visibility: 'hidden',
    },
    accountId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Salesforce Account ID to update (18-character string starting with 001)',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Account name',
    },
    type: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Account type (e.g., Customer, Partner, Prospect)',
    },
    industry: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Industry (e.g., Technology, Healthcare, Finance)',
    },
    phone: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Phone number',
    },
    website: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Website URL',
    },
    billingStreet: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Billing street address',
    },
    billingCity: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Billing city',
    },
    billingState: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Billing state/province',
    },
    billingPostalCode: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Billing postal code',
    },
    billingCountry: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Billing country',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Account description',
    },
    annualRevenue: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Annual revenue as a number',
    },
    numberOfEmployees: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of employees as an integer',
    },
  },

  request: {
    url: (params) => {
      const instanceUrl = getInstanceUrl(params.idToken, params.instanceUrl)
      const accountId = requireId(params.accountId, 'Account ID')

      return `${instanceUrl}/services/data/v59.0/sobjects/Account/${accountId}`
    },
    method: 'PATCH',
    headers: (params) => {
      if (!params.accessToken) {
        throw new Error('Access token is required')
      }

      return {
        Authorization: `Bearer ${params.accessToken}`,
        'Content-Type': 'application/json',
      }
    },
    body: (params) => {
      const body: Record<string, any> = {}

      if (params.name) body.Name = params.name
      if (params.type) body.Type = params.type
      if (params.industry) body.Industry = params.industry
      if (params.phone) body.Phone = params.phone
      if (params.website) body.Website = params.website
      if (params.billingStreet) body.BillingStreet = params.billingStreet
      if (params.billingCity) body.BillingCity = params.billingCity
      if (params.billingState) body.BillingState = params.billingState
      if (params.billingPostalCode) body.BillingPostalCode = params.billingPostalCode
      if (params.billingCountry) body.BillingCountry = params.billingCountry
      if (params.description) body.Description = params.description
      if (params.annualRevenue) body.AnnualRevenue = Number.parseFloat(params.annualRevenue)
      if (params.numberOfEmployees)
        body.NumberOfEmployees = Number.parseInt(params.numberOfEmployees)

      return body
    },
  },

  transformResponse: async (response: Response, params) => {
    if (!response.ok) {
      const data = await response.json()
      throw new Error(
        extractErrorMessage(data, response.status, 'Failed to update account in Salesforce')
      )
    }

    return {
      success: true,
      output: {
        id: params?.accountId?.trim() || '',
        updated: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Updated account data',
      properties: SOBJECT_UPDATE_OUTPUT_PROPERTIES,
    },
  },
}
