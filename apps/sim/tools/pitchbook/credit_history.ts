import { ErrorExtractorId } from '@/tools/error-extractors'
import type { PitchbookResponse, PitchbookUsageWindowParams } from '@/tools/pitchbook/types'
import { PITCHBOOK_API_BASE, pitchbookAuthHeaders, throwIfNotOk } from '@/tools/pitchbook/utils'
import type { ToolConfig } from '@/tools/types'

export const pitchbookCreditHistoryTool: ToolConfig<PitchbookUsageWindowParams, PitchbookResponse> =
  {
    id: 'pitchbook_credit_history',
    name: 'PitchBook Credit History',
    description:
      'Retrieve API credit usage and remaining balance per contract, for up to the last 90 days',
    version: '1.0.0',
    errorExtractor: ErrorExtractorId.PITCHBOOK_ERRORS,

    params: {
      apiKey: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'PitchBook API key',
      },
      sinceDate: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description:
          'Window to report changes over, carrying its operator in the value: >YYYY-MM-DD for after a date, <YYYY-MM-DD for before one, or YYYY-MM-DD^YYYY-MM-DD for a range. Use this or trailingRange.',
      },
      trailingRange: {
        type: 'number',
        required: false,
        visibility: 'user-or-llm',
        description: 'Report changes over the last N days. Use this or sinceDate.',
      },
      currency: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description:
          'ISO currency code to convert monetary values into, sent as the X-Currency header (e.g. USD, EUR, JPY). Defaults to the currency on the account preferences.',
      },
    },

    request: {
      url: (params) => {
        const qs = new URLSearchParams()
        if (params.sinceDate) qs.set('sinceDate', params.sinceDate)
        if (params.trailingRange !== undefined && params.trailingRange !== null) {
          qs.set('trailingRange', String(params.trailingRange))
        }
        const query = qs.toString()
        return `${PITCHBOOK_API_BASE}/credits/history${query ? `?${query}` : ''}`
      },
      method: 'GET',
      headers: (params) => pitchbookAuthHeaders(params.apiKey, params.currency),
    },

    transformResponse: async (response: Response) => {
      await throwIfNotOk(response, 'Failed to fetch credit history')
      const data = await response.json()

      return {
        success: true,
        output: {
          credits: Array.isArray(data) ? data : [],
        },
      }
    },

    outputs: {
      credits: {
        type: 'array',
        description: 'Credit usage per contract over the window',
        items: {
          type: 'object',
          properties: {
            contractNumber: { type: 'string', description: 'Contract identifier' },
            activeContract: {
              type: 'boolean',
              description: 'Whether the contract is currently active',
            },
            pricingModel: { type: 'string', description: 'Pricing model of the contract' },
            creditsUsed: { type: 'number', description: 'Credits consumed' },
            creditsChanged: { type: 'number', description: 'Net credits added or removed' },
            creditsExpired: { type: 'number', description: 'Credits that expired' },
            creditsRemaining: { type: 'number', description: 'Credits still available' },
            overageUsed: { type: 'number', description: 'Overage credits consumed' },
          },
        },
      },
    },
  }
