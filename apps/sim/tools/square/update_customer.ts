import { ErrorExtractorId } from '@/tools/error-extractors'
import { SQUARE_CREDENTIAL_OAUTH } from '@/tools/shared/saved-credentials'
import type { CustomerResponse, UpdateCustomerParams } from '@/tools/square/types'
import {
  CUSTOMER_METADATA_OUTPUT_PROPERTIES,
  CUSTOMER_OUTPUT,
  SQUARE_ENVIRONMENTS,
  squareHeaders,
} from '@/tools/square/types'
import type { ToolConfig } from '@/tools/types'

export const squareUpdateCustomerTool: ToolConfig<UpdateCustomerParams, CustomerResponse> = {
  id: 'square_update_customer',
  name: 'Square Update Customer',
  description: 'Update fields on an existing customer profile',
  version: '1.0.0',
  oauth: SQUARE_CREDENTIAL_OAUTH,
  errorExtractor: ErrorExtractorId.SQUARE_ERRORS,

  params: {
    environment: SQUARE_ENVIRONMENTS.param,
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
      description: 'ID of the customer to update',
    },
    givenName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'First name of the customer',
    },
    familyName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Last name of the customer',
    },
    companyName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Business name of the customer',
    },
    nickname: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Nickname of the customer',
    },
    emailAddress: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Email address of the customer',
    },
    phoneNumber: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Phone number of the customer',
    },
    birthday: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Birthday in YYYY-MM-DD or MM-DD format',
    },
    note: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Note about the customer',
    },
    referenceId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional external reference for the customer',
    },
    address: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Square address object for the customer',
    },
  },

  request: {
    url: (params) =>
      `${SQUARE_ENVIRONMENTS.apiBase(params.environment)}/v2/customers/${encodeURIComponent(params.customerId)}`,
    method: 'PUT',
    headers: (params) => squareHeaders(params.apiKey),
    /**
     * Square treats a `null` field as "remove this value", and the canvas hands
     * untouched inputs over as `null`, so only filled-in fields are sent.
     */
    body: (params) => {
      const fields = {
        given_name: params.givenName,
        family_name: params.familyName,
        company_name: params.companyName,
        nickname: params.nickname,
        email_address: params.emailAddress,
        phone_number: params.phoneNumber,
        birthday: params.birthday,
        note: params.note,
        reference_id: params.referenceId,
        address: params.address,
      }
      const body: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(fields)) {
        if (value !== undefined && value !== null && value !== '') body[key] = value
      }
      return body
    },
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
    customer: { ...CUSTOMER_OUTPUT, description: 'The updated customer object' },
    metadata: {
      type: 'json',
      description: 'Customer summary metadata',
      properties: CUSTOMER_METADATA_OUTPUT_PROPERTIES,
    },
  },
}
