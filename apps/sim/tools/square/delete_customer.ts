import { ErrorExtractorId } from '@/tools/error-extractors'
import { SQUARE_CREDENTIAL_OAUTH } from '@/tools/shared/saved-credentials'
import type { CustomerDeleteResponse, DeleteCustomerParams } from '@/tools/square/types'
import { SQUARE_ENVIRONMENT_PARAM, squareBaseUrl, squareHeaders } from '@/tools/square/types'
import type { ToolConfig } from '@/tools/types'

export const squareDeleteCustomerTool: ToolConfig<DeleteCustomerParams, CustomerDeleteResponse> = {
  id: 'square_delete_customer',
  name: 'Square Delete Customer',
  description: 'Delete a customer profile from the Square customer directory',
  version: '1.0.0',
  oauth: SQUARE_CREDENTIAL_OAUTH,
  errorExtractor: ErrorExtractorId.SQUARE_ERRORS,

  params: {
    environment: SQUARE_ENVIRONMENT_PARAM,
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
      description: 'ID of the customer to delete',
    },
  },

  request: {
    url: (params) =>
      `${squareBaseUrl(params.environment)}/v2/customers/${encodeURIComponent(params.customerId)}`,
    method: 'DELETE',
    headers: (params) => squareHeaders(params.apiKey),
  },

  transformResponse: async (response, params) => {
    await response.json().catch(() => ({}))
    return {
      success: true,
      output: {
        deleted: true,
        id: params?.customerId ?? '',
      },
    }
  },

  outputs: {
    deleted: { type: 'boolean', description: 'Whether the customer was deleted' },
    id: { type: 'string', description: 'ID of the deleted customer' },
  },
}
