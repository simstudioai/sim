import { createLogger } from '@/lib/logs/console/logger'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('SalesforceCreateAccount')

export interface SalesforceCreateAccountParams {
  accessToken: string
  idToken?: string
  instanceUrl?: string
  name: string
  type?: string
  industry?: string
  phone?: string
  website?: string
  billingStreet?: string
  billingCity?: string
  billingState?: string
  billingPostalCode?: string
  billingCountry?: string
  description?: string
  annualRevenue?: string
  numberOfEmployees?: string
}

export interface SalesforceCreateAccountResponse {
  success: boolean
  output: {
    id: string
    success: boolean
    created: boolean
    metadata: {
      operation: 'create_account'
    }
  }
}

export const salesforceCreateAccountTool: ToolConfig<
  SalesforceCreateAccountParams,
  SalesforceCreateAccountResponse
> = {
  id: 'salesforce_create_account',
  name: 'Create Account in Salesforce',
  description: 'Create a new account in Salesforce CRM',
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
    name: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Account name (required)',
    },
    type: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Account type (e.g., Customer, Partner, Prospect)',
    },
    industry: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Industry (e.g., Technology, Healthcare, Finance)',
    },
    phone: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Phone number',
    },
    website: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Website URL',
    },
    billingStreet: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Billing street address',
    },
    billingCity: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Billing city',
    },
    billingState: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Billing state/province',
    },
    billingPostalCode: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Billing postal code',
    },
    billingCountry: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Billing country',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Account description',
    },
    annualRevenue: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Annual revenue (number)',
    },
    numberOfEmployees: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Number of employees (number)',
    },
  },

  request: {
    url: (params) => {
      let instanceUrl = params.instanceUrl

      if (!instanceUrl && params.idToken) {
        try {
          const base64Url = params.idToken.split('.')[1]
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
            if (match) {
              instanceUrl = match[1]
            }
          } else if (decoded.sub) {
            const match = decoded.sub.match(/^(https:\/\/[^/]+)/)
            if (match && match[1] !== 'https://login.salesforce.com') {
              instanceUrl = match[1]
            }
          }
        } catch (error) {
          logger.error('Failed to decode Salesforce idToken', { error })
        }
      }

      if (!instanceUrl) {
        throw new Error('Salesforce instance URL is required but not provided')
      }

      return `${instanceUrl}/services/data/v59.0/sobjects/Account`
    },
    method: 'POST',
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
      const body: Record<string, any> = {
        Name: params.name,
      }

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

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      logger.error('Salesforce API request failed', { data, status: response.status })
      throw new Error(data[0]?.message || data.message || 'Failed to create account in Salesforce')
    }

    return {
      success: true,
      output: {
        id: data.id,
        success: data.success,
        created: true,
        metadata: {
          operation: 'create_account' as const,
        },
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Created account data',
      properties: {
        id: { type: 'string', description: 'Created account ID' },
        success: { type: 'boolean', description: 'Salesforce operation success' },
        created: { type: 'boolean', description: 'Whether account was created' },
        metadata: { type: 'object', description: 'Operation metadata' },
      },
    },
  },
}
