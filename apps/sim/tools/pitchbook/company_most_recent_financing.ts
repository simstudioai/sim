import { ErrorExtractorId } from '@/tools/error-extractors'
import type { PitchbookProfileParams, PitchbookResponse } from '@/tools/pitchbook/types'
import { PITCHBOOK_API_BASE, pitchbookAuthHeaders, throwIfNotOk } from '@/tools/pitchbook/utils'
import type { ToolConfig } from '@/tools/types'

export const pitchbookCompanyMostRecentFinancingTool: ToolConfig<
  PitchbookProfileParams,
  PitchbookResponse
> = {
  id: 'pitchbook_company_most_recent_financing',
  name: 'PitchBook Company Most Recent Financing',
  description:
    'Retrieve a company most recent financing round: date, size, type, and last known valuation',
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
        'PitchBook company ID, e.g. 10618-03. Use PitchBook Search to resolve a name to an ID.',
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
    url: (params) => `${PITCHBOOK_API_BASE}/companies/${params.pbId.trim()}/most-recent-financing`,
    method: 'GET',
    headers: (params) => pitchbookAuthHeaders(params.apiKey, params.currency),
  },

  transformResponse: async (response: Response) => {
    await throwIfNotOk(response, 'Failed to fetch most recent financing')
    const data = await response.json()

    return {
      success: true,
      output: {
        companyId: data.companyId ?? null,
        lastFinancingDealId: data.lastFinancingDealId ?? null,
        lastFinancingDate: data.lastFinancingDate ?? null,
        lastFinancingSize: data.lastFinancingSize ?? null,
        lastFinancingSizeStatus: data.lastFinancingSizeStatus ?? null,
        lastFinancingValuation: data.lastFinancingValuation ?? null,
        lastFinancingValuationStatus: data.lastFinancingValuationStatus ?? null,
        lastFinancingDealType: data.lastFinancingDealType ?? null,
        lastFinancingDealType2: data.lastFinancingDealType2 ?? null,
        lastFinancingDealType3: data.lastFinancingDealType3 ?? null,
        lastFinancingDealClass: data.lastFinancingDealClass ?? null,
        lastKnownValuation: data.lastKnownValuation ?? null,
        lastKnownValuationDate: data.lastKnownValuationDate ?? null,
        lastKnownValuationDealType: data.lastKnownValuationDealType ?? null,
      },
    }
  },

  outputs: {
    companyId: { type: 'string', description: 'PitchBook company ID', nullable: true },
    lastFinancingDealId: {
      type: 'string',
      description: 'PitchBook deal ID of the most recent financing',
      nullable: true,
    },
    lastFinancingDate: {
      type: 'string',
      description: 'Date of the most recent financing (YYYY-MM-DD)',
      nullable: true,
    },
    lastFinancingSize: {
      type: 'object',
      description: 'Size of the most recent financing',
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
    lastFinancingSizeStatus: {
      type: 'string',
      description: 'Whether the financing size is actual or estimated',
      nullable: true,
    },
    lastFinancingValuation: {
      type: 'object',
      description: 'Valuation at the most recent financing',
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
    lastFinancingValuationStatus: {
      type: 'string',
      description: 'Whether the valuation is actual or estimated',
      nullable: true,
    },
    lastFinancingDealType: {
      type: 'object',
      description: 'Primary deal type of the most recent financing',
      nullable: true,
      properties: {
        code: { type: 'string', description: 'PitchBook code', nullable: true },
        description: {
          type: 'string',
          description: 'Human-readable label for the code',
          nullable: true,
        },
      },
    },
    lastFinancingDealType2: {
      type: 'object',
      description: 'Secondary deal type of the most recent financing',
      nullable: true,
      properties: {
        code: { type: 'string', description: 'PitchBook code', nullable: true },
        description: {
          type: 'string',
          description: 'Human-readable label for the code',
          nullable: true,
        },
      },
    },
    lastFinancingDealType3: {
      type: 'object',
      description: 'Tertiary deal type of the most recent financing',
      nullable: true,
      properties: {
        code: { type: 'string', description: 'PitchBook code', nullable: true },
        description: {
          type: 'string',
          description: 'Human-readable label for the code',
          nullable: true,
        },
      },
    },
    lastFinancingDealClass: {
      type: 'object',
      description: 'Deal class of the most recent financing',
      nullable: true,
      properties: {
        code: { type: 'string', description: 'PitchBook code', nullable: true },
        description: {
          type: 'string',
          description: 'Human-readable label for the code',
          nullable: true,
        },
      },
    },
    lastKnownValuation: {
      type: 'object',
      description: 'Most recent known valuation of the company',
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
    lastKnownValuationDate: {
      type: 'string',
      description: 'Date of the last known valuation (YYYY-MM-DD)',
      nullable: true,
    },
    lastKnownValuationDealType: {
      type: 'object',
      description: 'Deal type the last known valuation came from',
      nullable: true,
      properties: {
        code: { type: 'string', description: 'PitchBook code', nullable: true },
        description: {
          type: 'string',
          description: 'Human-readable label for the code',
          nullable: true,
        },
      },
    },
  },
}
