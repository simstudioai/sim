import type {
  LeadMagicGetCreditsParams,
  LeadMagicGetCreditsResponse,
} from '@/tools/leadmagic/types'
import type { ToolConfig } from '@/tools/types'

export const getCreditsTool: ToolConfig<LeadMagicGetCreditsParams, LeadMagicGetCreditsResponse> = {
  id: 'leadmagic_get_credits',
  name: 'LeadMagic Get Credits',
  description:
    'Retrieve the current credit balance for the authenticated LeadMagic account. This endpoint is free and consumes no credits.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'LeadMagic API Key',
    },
  },

  request: {
    url: 'https://api.leadmagic.io/v1/credits',
    method: 'GET',
    headers: (params) => ({
      'X-API-Key': params.apiKey,
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new Error(
        (errorData as Record<string, string>).message ||
          `LeadMagic API error: ${response.status} ${response.statusText}`
      )
    }
    const data = await response.json()
    return {
      success: true,
      output: {
        credits: data.credits ?? 0,
      },
    }
  },

  outputs: {
    credits: { type: 'number', description: 'Current credit balance' },
  },
}
