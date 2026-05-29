import type { Rb2bCreditCheckParams, Rb2bCreditCheckResponse } from '@/tools/rb2b/types'
import { RB2B_API_BASE, rb2bHeaders } from '@/tools/rb2b/utils'
import type { ToolConfig } from '@/tools/types'

export const rb2bCreditCheckTool: ToolConfig<Rb2bCreditCheckParams, Rb2bCreditCheckResponse> = {
  id: 'rb2b_credit_check',
  name: 'RB2B Credit Check',
  description: 'Check the number of API credits remaining on your RB2B account.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'RB2B API key',
    },
  },

  request: {
    method: 'GET',
    url: `${RB2B_API_BASE}/credits`,
    headers: (params) => rb2bHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        credits_remaining: data.credits_remaining ?? 0,
      },
    }
  },

  outputs: {
    credits_remaining: {
      type: 'number',
      description: 'Number of API credits remaining on the account',
    },
  },
}
