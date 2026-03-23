import type { ToolConfig, ToolResponse } from '@/tools/types'
import type { BoxSignResendRequestParams } from './types'

export const boxSignResendRequestTool: ToolConfig<BoxSignResendRequestParams, ToolResponse> = {
  id: 'box_sign_resend_request',
  name: 'Box Sign Resend Request',
  description: 'Resend a Box Sign request to signers who have not yet signed',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'box',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'OAuth access token for Box API',
    },
    signRequestId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the sign request to resend',
    },
  },

  request: {
    url: (params) => `https://api.box.com/2.0/sign_requests/${params.signRequestId}/resend`,
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },

  transformResponse: async (response) => {
    if (!response.ok) {
      const data = await response.json()
      throw new Error(data.message || `Box Sign API error: ${response.status}`)
    }

    return {
      success: true,
      output: {
        message: 'Sign request resent successfully',
      },
    }
  },

  outputs: {
    message: { type: 'string', description: 'Success confirmation message' },
  },
}
