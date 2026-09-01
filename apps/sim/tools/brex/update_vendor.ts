import {
  type BrexDeliveryContextParams,
  brexIdempotencyHeader,
  defineBrexKeyedSite,
} from '@/tools/brex/idempotency'
import type { BrexUpdateVendorParams, BrexUpdateVendorResponse } from '@/tools/brex/types'
import { BREX_API_BASE, buildBrexHeaders, parseBrexJson } from '@/tools/brex/utils'
import type { ToolConfig } from '@/tools/types'

/**
 * The only site here whose duplicate is harmless on its own: a PUT that sets the
 * same three fields to the same values converges. It is declared `keyed` rather
 * than `converge` because it does put a token on the wire — the two classes
 * carry identical retry policy, so this records what is actually sent without
 * changing behavior.
 */
const DELIVERY = defineBrexKeyedSite(
  'brex_update_vendor',
  'nothing user-visible — the same three vendor fields are set to the same values'
)

export const brexUpdateVendorTool: ToolConfig<
  BrexUpdateVendorParams & BrexDeliveryContextParams,
  BrexUpdateVendorResponse
> = {
  id: 'brex_update_vendor',
  name: 'Brex Update Vendor',
  description: 'Update an existing vendor in the Brex account',
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
      description: 'ID of the vendor to update',
    },
    companyName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New name for the vendor',
    },
    email: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New email address for the vendor',
    },
    phone: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New phone number for the vendor',
    },
  },

  request: {
    url: (params) => `${BREX_API_BASE}/v1/vendors/${encodeURIComponent(params.vendorId.trim())}`,
    method: 'PUT',
    headers: (params) => ({
      ...buildBrexHeaders(params.apiKey),
      ...brexIdempotencyHeader(DELIVERY, params),
    }),
    body: (params) => {
      const body: Record<string, unknown> = {}
      if (params.companyName) body.company_name = params.companyName
      if (params.email) body.email = params.email
      if (params.phone) body.phone = params.phone
      if (Object.keys(body).length === 0) {
        throw new Error(
          'At least one of company name, email, or phone must be provided to update the vendor'
        )
      }
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
