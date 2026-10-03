import { ErrorExtractorId } from '@/tools/error-extractors'
import type { PitchbookProfileParams, PitchbookResponse } from '@/tools/pitchbook/types'
import { PITCHBOOK_API_BASE, pitchbookAuthHeaders, throwIfNotOk } from '@/tools/pitchbook/utils'
import type { ToolConfig } from '@/tools/types'

export const pitchbookCompanyMostRecentFinancialsTool: ToolConfig<
  PitchbookProfileParams,
  PitchbookResponse
> = {
  id: 'pitchbook_company_most_recent_financials',
  name: 'PitchBook Company Most Recent Financials',
  description:
    'Retrieve the most recent reported financials for a private company: revenue, net income, EBITDA, assets, and debt',
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
    url: (params) => `${PITCHBOOK_API_BASE}/companies/${params.pbId.trim()}/most-recent-financials`,
    method: 'GET',
    headers: (params) => pitchbookAuthHeaders(params.apiKey, params.currency),
  },

  transformResponse: async (response: Response) => {
    await throwIfNotOk(response, 'Failed to fetch most recent financials')
    const data = await response.json()

    return {
      success: true,
      output: {
        companyId: data.companyId ?? null,
        period: data.period ?? null,
        endDate: data.endDate ?? null,
        enterpriseValue: data.enterpriseValue ?? null,
        revenue: data.revenue ?? null,
        netIncome: data.netIncome ?? null,
        ebitda: data.ebitda ?? null,
        totalAssets: data.totalAssets ?? null,
        totalDebt: data.totalDebt ?? null,
      },
    }
  },

  outputs: {
    companyId: { type: 'string', description: 'PitchBook company ID', nullable: true },
    period: { type: 'number', description: 'Fiscal period the figures cover', nullable: true },
    endDate: { type: 'string', description: 'Period end date (YYYY-MM-DD)', nullable: true },
    enterpriseValue: {
      type: 'object',
      description: 'Enterprise value',
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
    revenue: {
      type: 'object',
      description: 'Revenue',
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
    netIncome: {
      type: 'object',
      description: 'Net income',
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
    ebitda: {
      type: 'object',
      description: 'EBITDA',
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
    totalAssets: {
      type: 'object',
      description: 'Total assets',
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
    totalDebt: {
      type: 'object',
      description: 'Total debt',
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
  },
}
