import type { EnrichCheckCreditsParams, EnrichCheckCreditsResponse } from '@/tools/enrich/types'
import type { ToolConfig } from '@/tools/types'

export const checkCreditsTool: ToolConfig<EnrichCheckCreditsParams, EnrichCheckCreditsResponse> = {
  id: 'enrich_check_credits',
  name: 'Enrich Check Credits',
  description: 'Check your Enrich API credit usage and remaining balance.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Enrich API key',
    },
  },

  request: {
    url: 'https://api.enrich.so/v1/api/auth',
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    return {
      success: true,
      output: {
        totalCredits: data.total_credits ?? 0,
        creditsUsed: data.credits_used ?? 0,
        creditsRemaining: data.credits_remaining ?? 0,
      },
    }
  },

  outputs: {
    totalCredits: {
      type: 'number',
      description: 'Total credits allocated to the account',
    },
    creditsUsed: {
      type: 'number',
      description: 'Credits consumed so far',
    },
    creditsRemaining: {
      type: 'number',
      description: 'Available credits remaining',
    },
  },
}
