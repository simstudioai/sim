import { ErrorExtractorId } from '@/tools/error-extractors'
import type { PitchbookProfileParams, PitchbookResponse } from '@/tools/pitchbook/types'
import { PITCHBOOK_API_BASE, pitchbookAuthHeaders, throwIfNotOk } from '@/tools/pitchbook/utils'
import type { ToolConfig } from '@/tools/types'

export const pitchbookDealDebtLendersTool: ToolConfig<PitchbookProfileParams, PitchbookResponse> = {
  id: 'pitchbook_deal_debt_lenders',
  name: 'PitchBook Deal Debt and Lenders',
  description:
    'Retrieve the debt raised in a deal and the lenders behind it, with rate, maturity, seniority, and covenant terms',
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
      description: 'PitchBook deal ID, e.g. 52721-65T. Deal IDs end in T.',
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
    url: (params) => `${PITCHBOOK_API_BASE}/deals/${params.pbId.trim()}/debt-lenders`,
    method: 'GET',
    headers: (params) => pitchbookAuthHeaders(params.apiKey, params.currency),
  },

  transformResponse: async (response: Response) => {
    await throwIfNotOk(response, 'Failed to fetch deal debt and lenders')
    const data = await response.json()

    return {
      success: true,
      output: {
        dealId: data.dealId ?? null,
        dealNumber: data.dealNumber ?? null,
        company: data.company ?? null,
        debts: data.debts ?? [],
      },
    }
  },

  outputs: {
    dealId: { type: 'string', description: 'PitchBook deal ID', nullable: true },
    dealNumber: {
      type: 'number',
      description: 'Sequence of the deal in the company financing history',
      nullable: true,
    },
    company: {
      type: 'object',
      description: 'Company the record belongs to',
      properties: {
        id: { type: 'string', description: 'PitchBook person ID' },
        name: { type: 'string', description: 'Name' },
      },
    },
    debts: {
      type: 'array',
      description: 'Debt instruments in the deal',
      items: {
        type: 'object',
        properties: {
          debtSize: { type: 'json', description: 'Size of the debt instrument', nullable: true },
          paymentInKind: {
            type: 'json',
            description: 'Whether interest is paid in kind',
            nullable: true,
          },
          debtType: {
            type: 'object',
            description: 'Type of debt',
            properties: {
              code: { type: 'string', description: 'PitchBook code' },
              description: { type: 'string', description: 'Human-readable label for the code' },
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
          maturityDate: { type: 'json', description: 'Maturity date (YYYY-MM-DD)', nullable: true },
          spreadInterestRate: {
            type: 'json',
            description: 'Spread over the reference interest rate',
            nullable: true,
          },
          lenders: {
            type: 'array',
            description: 'Lenders on the debt',
            items: {
              type: 'object',
              properties: {
                lenderId: { type: 'string', description: 'PitchBook ID of the lender' },
                lenderName: { type: 'string', description: 'Name of the lender' },
                firmType: { type: 'string', description: 'Type of the associated firm' },
                serviceProviderType: {
                  type: 'object',
                  description: 'Service provider type',
                  properties: {
                    code: { type: 'string', description: 'PitchBook code' },
                    description: {
                      type: 'string',
                      description: 'Human-readable label for the code',
                    },
                  },
                },
                lenderSize: {
                  type: 'json',
                  description: 'Amount provided by the lender',
                  nullable: true,
                },
              },
            },
          },
        },
      },
    },
  },
}
