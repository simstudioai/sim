import type {
  MillionVerifierGetCreditsParams,
  MillionVerifierGetCreditsResponse,
} from '@/tools/millionverifier/types'
import type { ToolConfig } from '@/tools/types'

export const getCreditsTool: ToolConfig<
  MillionVerifierGetCreditsParams,
  MillionVerifierGetCreditsResponse
> = {
  id: 'millionverifier_get_credits',
  name: 'MillionVerifier Get Credits',
  description: 'Retrieve the remaining verification credits for the authenticated account.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'MillionVerifier API Key',
    },
  },

  request: {
    url: (params) =>
      `https://api.millionverifier.com/api/v3/credits?api=${encodeURIComponent(params.apiKey.trim())}`,
    method: 'GET',
    headers: () => ({ Accept: 'application/json' }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json().catch(() => ({}))
    const errorMessage =
      typeof data === 'object' && data !== null && typeof data.error === 'string' ? data.error : ''
    if (!response.ok || errorMessage.length > 0) {
      return {
        success: false,
        error:
          errorMessage || `MillionVerifier API error: ${response.status} ${response.statusText}`,
        output: { credits: 0 },
      }
    }
    // The credits endpoint may return either `{ credits }` or a bare number.
    const raw = typeof data === 'number' ? data : (data.credits ?? 0)
    const credits = Number(raw)
    return {
      success: true,
      output: { credits: Number.isNaN(credits) ? 0 : credits },
    }
  },

  outputs: {
    credits: { type: 'number', description: 'Remaining verification credits' },
  },
}
