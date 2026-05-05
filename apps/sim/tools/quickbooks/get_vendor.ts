import { createLogger } from '@sim/logger'
import type { QuickBooksGetVendorParams, QuickBooksVendorResponse } from '@/tools/quickbooks/types'
import { VENDOR_OUTPUT } from '@/tools/quickbooks/types'
import { buildCompanyUrl, quickbooksAuthHeaders } from '@/tools/quickbooks/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('QuickBooksGetVendor')

export const quickbooksGetVendorTool: ToolConfig<
  QuickBooksGetVendorParams,
  QuickBooksVendorResponse
> = {
  id: 'quickbooks_get_vendor',
  name: 'QuickBooks Get Vendor',
  description: 'Retrieve a single QuickBooks vendor by ID',
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
    vendorId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'QuickBooks vendor ID',
    },
  },

  request: {
    url: (params) =>
      `${buildCompanyUrl(params.realmId, `/vendor/${encodeURIComponent(params.vendorId.trim())}`)}?minorversion=73`,
    method: 'GET',
    headers: (params) => quickbooksAuthHeaders(params.accessToken),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!response.ok) {
      logger.error('QuickBooks get vendor failed', { status: response.status, data })
      throw new Error(data?.Fault?.Error?.[0]?.Message || 'Failed to get QuickBooks vendor')
    }
    const vendor = (data?.Vendor ?? null) as Record<string, unknown> | null
    return {
      success: true,
      output: {
        vendor,
        vendorId: vendor ? ((vendor.Id as string) ?? null) : null,
      },
    }
  },

  outputs: {
    vendor: { type: 'object', description: 'Vendor record', properties: VENDOR_OUTPUT },
    vendorId: { type: 'string', description: 'Vendor ID' },
  },
}
