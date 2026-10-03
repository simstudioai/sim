import { ErrorExtractorId } from '@/tools/error-extractors'
import type { PitchbookProfileParams, PitchbookResponse } from '@/tools/pitchbook/types'
import { PITCHBOOK_API_BASE, pitchbookAuthHeaders, throwIfNotOk } from '@/tools/pitchbook/utils'
import type { ToolConfig } from '@/tools/types'

export const pitchbookDealValuationTool: ToolConfig<PitchbookProfileParams, PitchbookResponse> = {
  id: 'pitchbook_deal_valuation',
  name: 'PitchBook Deal Valuation',
  description: 'Retrieve the pre-money and post-money valuation recorded for a deal',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.PITCHBOOK_ERRORS,

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'PitchBook API key',
    },
    pbId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'PitchBook deal ID, e.g. 52721-65T. Deal IDs end in T and come from a deal search or a company deals lookup.',
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
    url: (params) => `${PITCHBOOK_API_BASE}/deals/${params.pbId.trim()}/valuation`,
    method: 'GET',
    headers: (params) => pitchbookAuthHeaders(params.apiKey, params.currency),
  },

  transformResponse: async (response: Response) => {
    await throwIfNotOk(response, 'Failed to fetch deal valuation')
    const data = await response.json()

    return {
      success: true,
      output: {
        dealId: data.dealId ?? null,
        dealNumber: data.dealNumber ?? null,
        companyId: data.companyId ?? null,
        companyName: data.companyName ?? null,
        preValuation: data.preValuation ?? null,
        postValuation: data.postValuation ?? null,
        postValuationStatus: data.postValuationStatus ?? null,
      },
    }
  },

  outputs: {
    dealId: { type: 'string', description: 'PitchBook deal ID', nullable: true },
    dealNumber: {
      type: 'number',
      description: 'Sequence of this deal in the company financing history',
      nullable: true,
    },
    companyId: {
      type: 'string',
      description: 'PitchBook ID of the company in the deal',
      nullable: true,
    },
    companyName: { type: 'string', description: 'Name of the company in the deal', nullable: true },
    preValuation: {
      type: 'object',
      description: 'Pre-money valuation',
      nullable: true,
      properties: {
        amount: { type: 'number', description: 'Value in the requested currency', nullable: true },
        currency: { type: 'string', description: 'Currency of amount', nullable: true },
        nativeAmount: {
          type: 'number',
          description: 'Value in the currency it was originally reported in',
          nullable: true,
        },
        nativeCurrency: { type: 'string', description: 'Currency of nativeAmount', nullable: true },
        estimated: { type: 'boolean', description: 'Whether the value is a PitchBook estimate' },
      },
    },
    postValuation: {
      type: 'object',
      description: 'Post-money valuation',
      nullable: true,
      properties: {
        amount: { type: 'number', description: 'Value in the requested currency', nullable: true },
        currency: { type: 'string', description: 'Currency of amount', nullable: true },
        nativeAmount: {
          type: 'number',
          description: 'Value in the currency it was originally reported in',
          nullable: true,
        },
        nativeCurrency: { type: 'string', description: 'Currency of nativeAmount', nullable: true },
        estimated: { type: 'boolean', description: 'Whether the value is a PitchBook estimate' },
      },
    },
    postValuationStatus: {
      type: 'string',
      description: 'Whether the post-money valuation is actual or estimated',
      nullable: true,
    },
  },
}
