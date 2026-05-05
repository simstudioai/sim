import { createLogger } from '@sim/logger'
import type {
  QuickBooksCustomerResponse,
  QuickBooksUpdateCustomerParams,
} from '@/tools/quickbooks/types'
import { CUSTOMER_OUTPUT } from '@/tools/quickbooks/types'
import { buildCompanyUrl, quickbooksAuthHeaders } from '@/tools/quickbooks/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('QuickBooksUpdateCustomer')

export const quickbooksUpdateCustomerTool: ToolConfig<
  QuickBooksUpdateCustomerParams,
  QuickBooksCustomerResponse
> = {
  id: 'quickbooks_update_customer',
  name: 'QuickBooks Update Customer',
  description: 'Sparse-update an existing QuickBooks customer',
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
    customerId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Customer ID to update',
    },
    syncToken: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Current SyncToken from the customer record (required for updates)',
    },
    displayName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Display name',
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
        Id: params.customerId,
        SyncToken: params.syncToken,
        sparse: true,
      }
      if (params.displayName !== undefined) body.DisplayName = params.displayName
      if (params.companyName !== undefined) body.CompanyName = params.companyName
      if (params.givenName !== undefined) body.GivenName = params.givenName
      if (params.familyName !== undefined) body.FamilyName = params.familyName
      if (params.primaryEmail !== undefined) {
        body.PrimaryEmailAddr = { Address: params.primaryEmail }
      }
      if (params.primaryPhone !== undefined) {
        body.PrimaryPhone = { FreeFormNumber: params.primaryPhone }
      }
      if (params.notes !== undefined) body.Notes = params.notes
      if (Object.keys(body).length <= 3) {
        throw new Error(
          'update_customer requires at least one field to update (e.g., displayName, primaryEmail, notes)'
        )
      }
      return body
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!response.ok) {
      logger.error('QuickBooks update customer failed', { status: response.status, data })
      throw new Error(data?.Fault?.Error?.[0]?.Message || 'Failed to update QuickBooks customer')
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
    customer: { type: 'object', description: 'Updated customer', properties: CUSTOMER_OUTPUT },
    customerId: { type: 'string', description: 'Customer ID' },
  },
}
