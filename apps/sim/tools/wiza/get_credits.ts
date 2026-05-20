import type { ToolConfig } from '@/tools/types'
import type { WizaGetCreditsParams, WizaGetCreditsResponse } from '@/tools/wiza/types'

export const wizaGetCreditsTool: ToolConfig<WizaGetCreditsParams, WizaGetCreditsResponse> = {
  id: 'wiza_get_credits',
  name: 'Wiza Get Credits',
  description: 'Retrieve the remaining credits on your Wiza account',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Wiza API key',
    },
  },

  request: {
    url: 'https://wiza.co/api/meta/credits',
    method: 'GET',
    headers: (params: WizaGetCreditsParams) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Wiza API error: ${response.status} - ${errorText}`)
    }

    const data = await response.json()
    const credits = data.credits ?? {}

    return {
      success: true,
      output: {
        email_credits: credits.email_credits ?? null,
        phone_credits: credits.phone_credits ?? null,
        export_credits: credits.export_credits ?? null,
        api_credits: credits.api_credits ?? null,
      },
    }
  },

  outputs: {
    email_credits: {
      type: 'json',
      description: 'Remaining email credits (number or "unlimited")',
      optional: true,
    },
    phone_credits: {
      type: 'json',
      description: 'Remaining phone credits (number or "unlimited")',
      optional: true,
    },
    export_credits: { type: 'number', description: 'Remaining export credits', optional: true },
    api_credits: { type: 'number', description: 'Remaining API credits', optional: true },
  },
}
