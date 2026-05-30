import type {
  FindymailGetCreditsParams,
  FindymailGetCreditsResponse,
} from '@/tools/findymail/types'
import type { ToolConfig } from '@/tools/types'

export const getCreditsTool: ToolConfig<FindymailGetCreditsParams, FindymailGetCreditsResponse> = {
  id: 'findymail_get_credits',
  name: 'Findymail Get Credits',
  description: 'Retrieve the remaining finder and verifier credits for the authenticated account.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Findymail API Key',
    },
  },

  request: {
    url: 'https://app.findymail.com/api/credits',
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      Accept: 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      return {
        success: false,
        error:
          (errorData as Record<string, string>).message ||
          (errorData as Record<string, string>).error ||
          `Findymail API error: ${response.status} ${response.statusText}`,
        output: { credits: 0, verifier_credits: 0 },
      }
    }
    const data = await response.json()
    return {
      success: true,
      output: {
        credits: data.credits ?? 0,
        verifier_credits: data.verifier_credits ?? 0,
      },
    }
  },

  outputs: {
    credits: { type: 'number', description: 'Remaining finder credits' },
    verifier_credits: { type: 'number', description: 'Remaining verifier credits' },
  },
}
