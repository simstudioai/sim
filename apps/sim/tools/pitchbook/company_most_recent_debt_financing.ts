import { ErrorExtractorId } from '@/tools/error-extractors'
import type { PitchbookProfileParams, PitchbookResponse } from '@/tools/pitchbook/types'
import { PITCHBOOK_API_BASE, pitchbookAuthHeaders, throwIfNotOk } from '@/tools/pitchbook/utils'
import type { ToolConfig } from '@/tools/types'

export const pitchbookCompanyMostRecentDebtFinancingTool: ToolConfig<
  PitchbookProfileParams,
  PitchbookResponse
> = {
  id: 'pitchbook_company_most_recent_debt_financing',
  name: 'PitchBook Company Most Recent Debt Financing',
  description:
    'Retrieve a company most recent debt financing, including each debt instrument raised',
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
    url: (params) =>
      `${PITCHBOOK_API_BASE}/companies/${params.pbId.trim()}/most-recent-debt-financing`,
    method: 'GET',
    headers: (params) => pitchbookAuthHeaders(params.apiKey, params.currency),
  },

  transformResponse: async (response: Response) => {
    await throwIfNotOk(response, 'Failed to fetch most recent debt financing')
    const data = await response.json()

    return {
      success: true,
      output: {
        companyId: data.companyId ?? null,
        lastDebtFinancingDealId: data.lastDebtFinancingDealId ?? null,
        lastDebtFinancingDate: data.lastDebtFinancingDate ?? null,
        lastDebtFinancing: data.lastDebtFinancing ?? [],
      },
    }
  },

  outputs: {
    companyId: { type: 'string', description: 'PitchBook company ID', nullable: true },
    lastDebtFinancingDealId: {
      type: 'string',
      description: 'PitchBook deal ID of the most recent debt financing',
      nullable: true,
    },
    lastDebtFinancingDate: {
      type: 'string',
      description: 'Date of the most recent debt financing (YYYY-MM-DD)',
      nullable: true,
    },
    lastDebtFinancing: {
      type: 'array',
      description: 'Debt instruments in the most recent debt financing',
      items: {
        type: 'object',
        properties: {
          lastDebtFinancingType: {
            type: 'object',
            description: 'Type of the most recent debt financing',
            properties: {
              code: { type: 'string', description: 'PitchBook code' },
              description: { type: 'string', description: 'Human-readable label for the code' },
            },
          },
          lastDebtFinancingAmount: {
            type: 'object',
            description: 'Amount of the most recent debt financing',
            properties: {
              amount: { type: 'number', description: 'Value in the requested currency' },
              currency: { type: 'string', description: 'Currency of amount' },
              nativeAmount: {
                type: 'number',
                description: 'Value in the currency it was originally reported in',
              },
              nativeCurrency: { type: 'string', description: 'Currency of nativeAmount' },
              estimated: {
                type: 'boolean',
                description: 'Whether the value is a PitchBook estimate',
              },
            },
          },
          seniority: { type: 'json', description: 'Seniority of the debt', nullable: true },
          security: { type: 'json', description: 'Security backing the debt', nullable: true },
          subordination: { type: 'json', description: 'Subordination terms', nullable: true },
          term: { type: 'json', description: 'Term of the debt', nullable: true },
          additionalDebtCharacteristics: {
            type: 'object',
            description: 'Other characteristics of the debt',
            properties: {
              unitranche: { type: 'boolean', description: 'Whether the debt is unitranche' },
              syndicated: { type: 'boolean', description: 'Whether the debt is syndicated' },
              mezzanine: { type: 'boolean', description: 'Whether the debt is mezzanine' },
              covLite: { type: 'boolean', description: 'Whether the debt is covenant-lite' },
              warrants: { type: 'boolean', description: 'Whether warrants are attached' },
              convertible: {
                type: 'boolean',
                description: 'Whether the instrument is convertible',
              },
              rate: { type: 'json', description: 'Interest rate', nullable: true },
            },
          },
          lenders: {
            type: 'array',
            description: 'Lenders on the debt',
            items: { type: 'json' },
          },
        },
      },
    },
  },
}
