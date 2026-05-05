import { createLogger } from '@sim/logger'
import type {
  QuickBooksCreateCustomerParams,
  QuickBooksCustomerResponse,
} from '@/tools/quickbooks/types'
import { CUSTOMER_OUTPUT } from '@/tools/quickbooks/types'
import { buildCompanyUrl, quickbooksAuthHeaders } from '@/tools/quickbooks/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('QuickBooksCreateCustomer')

export const quickbooksCreateCustomerTool: ToolConfig<
  QuickBooksCreateCustomerParams,
  QuickBooksCustomerResponse
> = {
  id: 'quickbooks_create_customer',
  name: 'QuickBooks Create Customer',
  description: 'Create a new customer in QuickBooks Online',
  version: '1.0.0',

  oauth: { required: true, provider: 'quickbooks' },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'QuickBooks OAuth access token',
    },
    realmId: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'QuickBooks company ID (realmId) — captured at OAuth time',
    },
    displayName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Display name (must be unique within the company)',
    },
    companyName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Company name',
    },
    givenName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'First name',
    },
    familyName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Last name',
    },
    primaryEmail: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Primary email address',
    },
    primaryPhone: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Primary phone number',
    },
    notes: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Free-form notes',
    },
  },

  request: {
    url: (params) => `${buildCompanyUrl(params.realmId, '/customer')}?minorversion=73`,
    method: 'POST',
    headers: (params) => quickbooksAuthHeaders(params.accessToken),
    body: (params) => {
      const body: Record<string, unknown> = {
        DisplayName: params.displayName,
      }
      if (params.companyName) body.CompanyName = params.companyName
      if (params.givenName) body.GivenName = params.givenName
      if (params.familyName) body.FamilyName = params.familyName
      if (params.primaryEmail) body.PrimaryEmailAddr = { Address: params.primaryEmail }
      if (params.primaryPhone) body.PrimaryPhone = { FreeFormNumber: params.primaryPhone }
      if (params.notes) body.Notes = params.notes
      return body
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!response.ok) {
      logger.error('QuickBooks create customer failed', { status: response.status, data })
      throw new Error(data?.Fault?.Error?.[0]?.Message || 'Failed to create QuickBooks customer')
    }
    const customer = (data?.Customer ?? null) as Record<string, unknown> | null
    return {
      success: true,
      output: {
        customer,
        customerId: customer ? ((customer.Id as string) ?? null) : null,
      },
    }
  },

  outputs: {
    customer: { type: 'object', description: 'Created customer', properties: CUSTOMER_OUTPUT },
    customerId: { type: 'string', description: 'New customer ID' },
  },
}
