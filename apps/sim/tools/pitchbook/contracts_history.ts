import { ErrorExtractorId } from '@/tools/error-extractors'
import type { PitchbookContractsHistoryParams, PitchbookResponse } from '@/tools/pitchbook/types'
import { PITCHBOOK_API_BASE, pitchbookAuthHeaders, throwIfNotOk } from '@/tools/pitchbook/utils'
import type { ToolConfig } from '@/tools/types'

export const pitchbookContractsHistoryTool: ToolConfig<
  PitchbookContractsHistoryParams,
  PitchbookResponse
> = {
  id: 'pitchbook_contracts_history',
  name: 'PitchBook Contracts History',
  description:
    'Retrieve the API contracts on the account with their pricing model, term, and credit balances',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.PITCHBOOK_ERRORS,

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'PitchBook API key',
    },
    activeContract: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Set true for only active contracts, false for only past ones. Omit to return every contract.',
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
      if (params.activeContract !== undefined && params.activeContract !== null) {
        qs.set('activeContract', String(params.activeContract))
      }
      const query = qs.toString()
      return `${PITCHBOOK_API_BASE}/contracts/history${query ? `?${query}` : ''}`
    },
    method: 'GET',
    headers: (params) => pitchbookAuthHeaders(params.apiKey, params.currency),
  },

  transformResponse: async (response: Response) => {
    await throwIfNotOk(response, 'Failed to fetch contracts history')
    const data = await response.json()

    return {
      success: true,
      output: {
        contracts: Array.isArray(data) ? data : [],
      },
    }
  },

  outputs: {
    contracts: {
      type: 'array',
      description: 'Contracts on the account',
      items: {
        type: 'object',
        properties: {
          contractNumber: { type: 'string', description: 'Contract identifier' },
          activeContract: {
            type: 'boolean',
            description: 'Whether the contract is currently active',
          },
          pricingModel: { type: 'string', description: 'Pricing model of the contract' },
          startDate: { type: 'string', description: 'Start date (YYYY-MM-DD)' },
          endDate: { type: 'string', description: 'End date (YYYY-MM-DD)', nullable: true },
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
