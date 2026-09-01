import { ErrorExtractorId } from '@/tools/error-extractors'
import type { PitchbookProfileParams, PitchbookResponse } from '@/tools/pitchbook/types'
import { PITCHBOOK_API_BASE, pitchbookAuthHeaders, throwIfNotOk } from '@/tools/pitchbook/utils'
import type { ToolConfig } from '@/tools/types'

export const pitchbookCompanyInvestorsTool: ToolConfig<PitchbookProfileParams, PitchbookResponse> =
  {
    id: 'pitchbook_company_investors',
    name: 'PitchBook Company Investors',
    description:
      'Retrieve every investor in a company, current and former, with the type of investor and when they invested',
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
      url: (params) => `${PITCHBOOK_API_BASE}/companies/${params.pbId.trim()}/investors`,
      method: 'GET',
      headers: (params) => pitchbookAuthHeaders(params.apiKey, params.currency),
    },

    transformResponse: async (response: Response) => {
      await throwIfNotOk(response, 'Failed to fetch company investors')
      const data = await response.json()

      return {
        success: true,
        output: {
          countAllInvestors: data.countAllInvestors ?? 0,
          investors: data.investors ?? [],
        },
      }
    },

    outputs: {
      countAllInvestors: { type: 'number', description: 'Total number of investors on record' },
      investors: {
        type: 'array',
        description: 'Investors in the company, current and former',
        items: {
          type: 'object',
          properties: {
            companyId: { type: 'string', description: 'PitchBook company ID' },
            investorId: { type: 'string', description: 'PitchBook investor ID' },
            investorName: { type: 'string', description: 'Investor name' },
            investorTypes: {
              type: 'array',
              description: 'Types the investor is classified as, one flagged primary',
              items: {
                type: 'object',
                properties: {
                  type: {
                    type: 'object',
                    description: 'Investor type',
                    properties: {
                      code: { type: 'string', description: 'Investor type code' },
                      description: { type: 'string', description: 'Investor type label' },
                    },
                  },
                  primary: { type: 'boolean', description: 'Whether this is the primary type' },
                },
              },
            },
            investorSince: {
              type: 'string',
              description: 'Date the investor first invested (YYYY-MM-DD)',
              nullable: true,
            },
            investorExit: {
              type: 'string',
              description: 'Date the investor exited (YYYY-MM-DD)',
              nullable: true,
            },
            investorStatus: {
              type: 'object',
              description: 'Whether the investor is current or former',
              nullable: true,
              properties: {
                code: { type: 'string', description: 'Status code', nullable: true },
                description: { type: 'string', description: 'Status label', nullable: true },
              },
            },
          },
        },
      },
    },
  }
