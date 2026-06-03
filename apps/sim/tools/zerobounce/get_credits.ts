import type { ToolConfig } from '@/tools/types'
import type {
  ZeroBounceGetCreditsParams,
  ZeroBounceGetCreditsResponse,
} from '@/tools/zerobounce/types'

export const getCreditsTool: ToolConfig<ZeroBounceGetCreditsParams, ZeroBounceGetCreditsResponse> =
  {
    id: 'zerobounce_get_credits',
    name: 'ZeroBounce Get Credits',
    description: 'Retrieve the remaining validation credits for the authenticated account.',
    version: '1.0.0',

    params: {
      apiKey: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'ZeroBounce API Key',
      },
    },

    request: {
      url: (params) =>
        `https://api.zerobounce.net/v2/getcredits?api_key=${encodeURIComponent(params.apiKey.trim())}`,
      method: 'GET',
      headers: () => ({ Accept: 'application/json' }),
    },

    transformResponse: async (response: Response) => {
      const data = await response.json().catch(() => ({}))
      // ZeroBounce returns HTTP 200 with an `{ error }` envelope on auth failure,
      // so detect API-level errors from the body, not just the HTTP status.
      const errorMessage =
        typeof data === 'object' && data !== null && typeof data.error === 'string'
          ? data.error
          : ''
      if (!response.ok || errorMessage.length > 0) {
        return {
          success: false,
          error: errorMessage || `ZeroBounce API error: ${response.status} ${response.statusText}`,
          output: { credits: 0 },
        }
      }
      const credits = Number(data.Credits ?? 0)
      return {
        success: true,
        output: { credits: Number.isNaN(credits) ? 0 : credits },
      }
    },

    outputs: {
      credits: {
        type: 'number',
        description: 'Remaining validation credits (-1 if unavailable)',
      },
    },
  }
