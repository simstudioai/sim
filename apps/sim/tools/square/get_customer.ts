import { ErrorExtractorId } from '@/tools/error-extractors'
import type { CustomerResponse, GetCustomerParams } from '@/tools/square/types'
import {
  CUSTOMER_METADATA_OUTPUT_PROPERTIES,
  CUSTOMER_OUTPUT,
  SQUARE_BASE_URL,
  squareHeaders,
} from '@/tools/square/types'
import type { ToolConfig } from '@/tools/types'

export const squareGetCustomerTool: ToolConfig<GetCustomerParams, CustomerResponse> = {
  id: 'square_get_customer',
  name: 'Square Get Customer',
  description: 'Retrieve a single customer profile by its ID',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.SQUARE_ERRORS,

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Square access token (personal access token)',
    },
    customerId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the customer to retrieve',
    },
  },

  request: {
    url: (params) => `${SQUARE_BASE_URL}/v2/customers/${encodeURIComponent(params.customerId)}`,
    method: 'GET',
    headers: (params) => squareHeaders(params.apiKey),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    const customer = data.customer ?? {}
    return {
      success: true,
      output: {
        customer,
        metadata: {
          id: customer.id,
          email_address: customer.email_address ?? null,
          given_name: customer.given_name ?? null,
          family_name: customer.family_name ?? null,
        },
      },
    }
  },

  outputs: {
    customer: { ...CUSTOMER_OUTPUT, description: 'The retrieved customer object' },
    metadata: {
      type: 'json',
      description: 'Customer summary metadata',
      properties: CUSTOMER_METADATA_OUTPUT_PROPERTIES,
    },
  },
}
