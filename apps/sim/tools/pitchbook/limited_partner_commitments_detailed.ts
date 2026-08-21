import { ErrorExtractorId } from '@/tools/error-extractors'
import type { PitchbookProfileParams, PitchbookResponse } from '@/tools/pitchbook/types'
import { PITCHBOOK_API_BASE, pitchbookAuthHeaders, throwIfNotOk } from '@/tools/pitchbook/utils'
import type { ToolConfig } from '@/tools/types'

export const pitchbookLimitedPartnerCommitmentsDetailedTool: ToolConfig<
  PitchbookProfileParams,
  PitchbookResponse
> = {
  id: 'pitchbook_limited_partner_commitments_detailed',
  name: 'PitchBook Limited Partner Commitments',
  description:
    'Retrieve every fund commitment a limited partner has made, with date, size, status, and the managers behind each fund',
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
      description: 'PitchBook limited partner ID, e.g. 58901-50.',
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
      `${PITCHBOOK_API_BASE}/limited-partners/${params.pbId.trim()}/commitments-detailed`,
    method: 'GET',
    headers: (params) => pitchbookAuthHeaders(params.apiKey, params.currency),
  },

  transformResponse: async (response: Response) => {
    await throwIfNotOk(response, 'Failed to fetch limited partner commitments')
    const data = await response.json()

    return {
      success: true,
      output: {
        commitments: Array.isArray(data) ? data : [],
      },
    }
  },

  outputs: {
    commitments: {
      type: 'array',
      description: 'Fund commitments the limited partner has made',
      items: {
        type: 'object',
        properties: {
          limitedPartnerId: { type: 'string', description: 'PitchBook limited partner ID' },
          committedFundId: { type: 'string', description: 'PitchBook ID of the fund committed to' },
          committedFundName: { type: 'string', description: 'Name of the fund committed to' },
          committedInvestors: {
            type: 'array',
            description: 'Managers of the fund committed to',
            items: {
              type: 'object',
              properties: {
                committedInvestorName: { type: 'string', description: 'Name of the fund manager' },
                committedInvestorId: {
                  type: 'string',
                  description: 'PitchBook ID of the fund manager',
                },
              },
            },
          },
          commitmentDate: {
            type: 'string',
            description: 'Date of the commitment (YYYY-MM-DD)',
            nullable: true,
          },
          commitmentSize: {
            type: 'object',
            description: 'Size of the commitment',
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
          commitmentStatus: {
            type: 'object',
            description: 'Status of the commitment',
            nullable: true,
            properties: {
              description: { type: 'string', description: 'Human-readable label for the code' },
              code: { type: 'string', description: 'PitchBook code' },
            },
          },
          commitmentType: {
            type: 'object',
            description: 'Type of the commitment',
            nullable: true,
            properties: {
              description: { type: 'string', description: 'Human-readable label for the code' },
              code: { type: 'string', description: 'PitchBook code' },
            },
          },
        },
      },
    },
  },
}
