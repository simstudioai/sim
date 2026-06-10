import type {
  NeverBounceGetCreditsParams,
  NeverBounceGetCreditsResponse,
} from '@/tools/neverbounce/types'
import type { ToolConfig } from '@/tools/types'

export const getCreditsTool: ToolConfig<
  NeverBounceGetCreditsParams,
  NeverBounceGetCreditsResponse
> = {
  id: 'neverbounce_get_credits',
  name: 'NeverBounce Get Credits',
  description: 'Retrieve the remaining paid and free verification credits for the account.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'NeverBounce API Key',
    },
  },

  request: {
    url: (params) =>
      `https://api.neverbounce.com/v4/account/info?key=${encodeURIComponent(params.apiKey.trim())}`,
    method: 'GET',
    headers: () => ({ Accept: 'application/json' }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json().catch(() => ({}))
    if (!response.ok || data.status !== 'success') {
      return {
        success: false,
        error:
          (data as Record<string, string>).message ||
          `NeverBounce API error: ${response.status} ${response.statusText}`,
        output: { credits: 0, freeCredits: 0 },
      }
    }
    const creditsInfo = (data.credits_info ?? {}) as Record<string, number>
    return {
      success: true,
      output: {
        credits: creditsInfo.paid_credits_remaining ?? 0,
        freeCredits: creditsInfo.free_credits_remaining ?? 0,
      },
    }
  },

  outputs: {
    credits: { type: 'number', description: 'Remaining paid verification credits' },
    freeCredits: { type: 'number', description: 'Remaining free verification credits' },
  },
}
