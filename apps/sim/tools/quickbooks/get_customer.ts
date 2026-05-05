import { createLogger } from '@sim/logger'
import type {
  QuickBooksCustomerResponse,
  QuickBooksGetCustomerParams,
} from '@/tools/quickbooks/types'
import { CUSTOMER_OUTPUT } from '@/tools/quickbooks/types'
import { buildCompanyUrl, quickbooksAuthHeaders } from '@/tools/quickbooks/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('QuickBooksGetCustomer')

export const quickbooksGetCustomerTool: ToolConfig<
  QuickBooksGetCustomerParams,
  QuickBooksCustomerResponse
> = {
  id: 'quickbooks_get_customer',
  name: 'QuickBooks Get Customer',
  description: 'Retrieve a single QuickBooks customer by ID',
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
      description: 'QuickBooks customer ID',
    },
  },

  request: {
    url: (params) =>
      `${buildCompanyUrl(params.realmId, `/customer/${encodeURIComponent(params.customerId.trim())}`)}?minorversion=73`,
    method: 'GET',
    headers: (params) => quickbooksAuthHeaders(params.accessToken),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!response.ok) {
      logger.error('QuickBooks get customer failed', { status: response.status, data })
      throw new Error(data?.Fault?.Error?.[0]?.Message || 'Failed to get QuickBooks customer')
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
    customer: { type: 'object', description: 'Customer record', properties: CUSTOMER_OUTPUT },
    customerId: { type: 'string', description: 'Customer ID' },
  },
}
