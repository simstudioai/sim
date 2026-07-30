import { generateId } from '@sim/utils/id'
import type { BrexCreateVendorParams, BrexCreateVendorResponse } from '@/tools/brex/types'
import { BREX_API_BASE, buildBrexHeaders, parseBrexJson } from '@/tools/brex/utils'
import type { ToolConfig } from '@/tools/types'

export const brexCreateVendorTool: ToolConfig<BrexCreateVendorParams, BrexCreateVendorResponse> = {
  id: 'brex_create_vendor',
  name: 'Brex Create Vendor',
  description: 'Create a new vendor in the Brex account',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Brex user token (generated from Developer Settings in the Brex dashboard)',
    },
    companyName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name for the vendor (must be unique)',
    },
    email: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Email address for the vendor',
    },
    phone: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Phone number for the vendor',
    },
  },

  request: {
    url: () => `${BREX_API_BASE}/v1/vendors`,
    method: 'POST',
    headers: (params) => ({
      ...buildBrexHeaders(params.apiKey),
      'Idempotency-Key': generateId(),
    }),
    body: (params) => {
      const body: Record<string, unknown> = { company_name: params.companyName }
      if (params.email) body.email = params.email
      if (params.phone) body.phone = params.phone
      return body
    },
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
    paymentAccounts: { type: 'array', description: 'Payment accounts associated with the vendor' },
  },
}
