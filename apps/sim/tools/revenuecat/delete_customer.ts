import type { DeleteCustomerParams, DeleteCustomerResponse } from '@/tools/revenuecat/types'
import { DELETE_OUTPUT_PROPERTIES } from '@/tools/revenuecat/types'
import type { ToolConfig } from '@/tools/types'

export const revenuecatDeleteCustomerTool: ToolConfig<
  DeleteCustomerParams,
  DeleteCustomerResponse
> = {
  id: 'revenuecat_delete_customer',
  name: 'RevenueCat Delete Customer',
  description: 'Permanently delete a subscriber and all associated data',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'RevenueCat secret API key (sk_...)',
    },
    appUserId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The app user ID of the subscriber to delete',
    },
  },

  request: {
    url: (params) =>
      `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(params.appUserId)}`,
    method: 'DELETE',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response, params) => {
    return {
      success: response.ok,
      output: {
        deleted: response.ok,
        app_user_id: params?.appUserId ?? '',
      },
    }
  },

  outputs: {
    deleted: DELETE_OUTPUT_PROPERTIES.deleted,
    app_user_id: DELETE_OUTPUT_PROPERTIES.app_user_id,
  },
}
