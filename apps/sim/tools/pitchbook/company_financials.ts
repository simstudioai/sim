import { ErrorExtractorId } from '@/tools/error-extractors'
import type { PitchbookProfileParams, PitchbookResponse } from '@/tools/pitchbook/types'
import { PITCHBOOK_API_BASE, pitchbookAuthHeaders, throwIfNotOk } from '@/tools/pitchbook/utils'
import type { ToolConfig } from '@/tools/types'

export const pitchbookCompanyFinancialsTool: ToolConfig<PitchbookProfileParams, PitchbookResponse> =
  {
    id: 'pitchbook_company_financials',
    name: 'PitchBook Company Financials',
    description:
      'Retrieve reported financials for a private company across every available fiscal period. Annual data is returned by default.',
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
      url: (params) => `${PITCHBOOK_API_BASE}/companies/${params.pbId.trim()}/financials`,
      method: 'GET',
      headers: (params) => pitchbookAuthHeaders(params.apiKey, params.currency),
    },

    transformResponse: async (response: Response) => {
      await throwIfNotOk(response, 'Failed to fetch company financials')
      const data = await response.json()

      return {
        success: true,
        output: {
          companyId: data.companyId ?? null,
          items: data.items ?? [],
        },
      }
    },

    outputs: {
      companyId: { type: 'string', description: 'PitchBook company ID' },
      items: {
        type: 'array',
        description: 'Records returned',
        items: {
          type: 'object',
          properties: {
            period: { type: 'string', description: 'Fiscal period the figures cover' },
            endDate: { type: 'string', description: 'End date (YYYY-MM-DD)' },
            enterpriseValue: {
              type: 'object',
              description: 'Enterprise value',
              nullable: true,
              properties: {
                nativeCurrency: { type: 'string', description: 'Currency of nativeAmount' },
                currency: { type: 'string', description: 'Currency of amount' },
                amount: { type: 'number', description: 'Value in the requested currency' },
                estimated: {
                  type: 'boolean',
                  description: 'Whether the value is a PitchBook estimate',
                },
                nativeAmount: {
                  type: 'number',
                  description: 'Value in the currency it was originally reported in',
                },
              },
            },
            revenue: {
              type: 'object',
              description: 'Revenue',
              nullable: true,
              properties: {
                nativeCurrency: { type: 'string', description: 'Currency of nativeAmount' },
                currency: { type: 'string', description: 'Currency of amount' },
                amount: { type: 'number', description: 'Value in the requested currency' },
                estimated: {
                  type: 'boolean',
                  description: 'Whether the value is a PitchBook estimate',
                },
                nativeAmount: {
                  type: 'number',
                  description: 'Value in the currency it was originally reported in',
                },
              },
            },
            netIncome: {
              type: 'object',
              description: 'Net income',
              properties: {
                nativeCurrency: { type: 'string', description: 'Currency of nativeAmount' },
                currency: { type: 'string', description: 'Currency of amount' },
                amount: { type: 'number', description: 'Value in the requested currency' },
                estimated: {
                  type: 'boolean',
                  description: 'Whether the value is a PitchBook estimate',
                },
                nativeAmount: {
                  type: 'number',
                  description: 'Value in the currency it was originally reported in',
                },
              },
            },
            ebitda: {
              type: 'object',
              description: 'EBITDA',
              properties: {
                nativeCurrency: { type: 'string', description: 'Currency of nativeAmount' },
                currency: { type: 'string', description: 'Currency of amount' },
                amount: { type: 'number', description: 'Value in the requested currency' },
                estimated: {
                  type: 'boolean',
                  description: 'Whether the value is a PitchBook estimate',
                },
                nativeAmount: {
                  type: 'number',
                  description: 'Value in the currency it was originally reported in',
                },
              },
            },
            totalAssets: {
              type: 'object',
              description: 'Total assets',
              nullable: true,
              properties: {
                nativeCurrency: { type: 'string', description: 'Currency of nativeAmount' },
                currency: { type: 'string', description: 'Currency of amount' },
                amount: { type: 'number', description: 'Value in the requested currency' },
                estimated: {
                  type: 'boolean',
                  description: 'Whether the value is a PitchBook estimate',
                },
                nativeAmount: {
                  type: 'number',
                  description: 'Value in the currency it was originally reported in',
                },
              },
            },
            totalDebt: {
              type: 'object',
              description: 'Total debt',
              nullable: true,
              properties: {
                nativeCurrency: { type: 'string', description: 'Currency of nativeAmount' },
                currency: { type: 'string', description: 'Currency of amount' },
                amount: { type: 'number', description: 'Value in the requested currency' },
                estimated: {
                  type: 'boolean',
                  description: 'Whether the value is a PitchBook estimate',
                },
                nativeAmount: {
                  type: 'number',
                  description: 'Value in the currency it was originally reported in',
                },
              },
            },
          },
        },
      },
    },
  }
