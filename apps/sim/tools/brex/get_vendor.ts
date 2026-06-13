import type { BrexGetVendorParams, BrexGetVendorResponse } from '@/tools/brex/types'
import { BREX_API_BASE, buildBrexHeaders, parseBrexJson } from '@/tools/brex/utils'
import type { ToolConfig } from '@/tools/types'

export const brexGetVendorTool: ToolConfig<BrexGetVendorParams, BrexGetVendorResponse> = {
  id: 'brex_get_vendor',
  name: 'Brex Get Vendor',
  description: 'Get a Brex vendor by its ID',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Brex user token (generated from Developer Settings in the Brex dashboard)',
    },
    vendorId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the vendor to fetch',
    },
  },

  request: {
    url: (params) => `${BREX_API_BASE}/v1/vendors/${encodeURIComponent(params.vendorId.trim())}`,
    method: 'GET',
    headers: (params) => buildBrexHeaders(params.apiKey),
  },

  transformResponse: async (response) => {
    const data = await parseBrexJson(response)
    return {
      success: true,
      output: {
        id: data.id ?? '',
        companyName: data.company_name ?? null,
        email: data.email ?? null,
        phone: data.phone ?? null,
        paymentAccounts: data.payment_accounts ?? [],
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'Unique vendor ID' },
    companyName: { type: 'string', description: 'Vendor company name', optional: true },
    email: { type: 'string', description: 'Vendor email address', optional: true },
    phone: { type: 'string', description: 'Vendor phone number', optional: true },
    paymentAccounts: {
      type: 'array',
      description: 'Payment accounts associated with the vendor',
    },
  },
}
