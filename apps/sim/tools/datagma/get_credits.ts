import type { DatagmaGetCreditsParams, DatagmaGetCreditsResponse } from '@/tools/datagma/types'
import type { ToolConfig } from '@/tools/types'

/**
 * Check the remaining credit balance on a Datagma account.
 *
 * Endpoint: GET https://gateway.datagma.net/api/ingress/v1/mine
 * Auth: apiId query param
 * Docs: https://datagmaapi.readme.io/reference/ingressservice_getcredit
 * Pricing: free (no credits consumed)
 */
export const getCreditsTool: ToolConfig<DatagmaGetCreditsParams, DatagmaGetCreditsResponse> = {
  id: 'datagma_get_credits',
  name: 'Datagma Get Credits',
  description: 'Check remaining credit balance on a Datagma account. Free — no credits consumed.',
  version: '1.0.0',

  // No hosting config — credit-balance lookup is free and should always use BYOK
  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Datagma API key',
    },
  },

  request: {
    url: (params) => {
      const url = new URL('https://gateway.datagma.net/api/ingress/v1/mine')
      url.searchParams.set('apiId', params.apiKey)
      return url.toString()
    },
    method: 'GET',
    headers: () => ({ Accept: 'application/json' }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      return {
        success: false,
        error:
          (errorData as Record<string, string>).message ||
          `Datagma API error: ${response.status} ${response.statusText}`,
        output: { credits: null },
      }
    }
    const data = (await response.json()) as Record<string, unknown>
    return {
      success: true,
      output: {
        credits: (data.credit as number | null) ?? (data.credits as number | null) ?? null,
      },
    }
  },

  outputs: {
    credits: { type: 'number', description: 'Remaining Datagma credits', optional: true },
  },
}
