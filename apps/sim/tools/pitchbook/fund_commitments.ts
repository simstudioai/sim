import { ErrorExtractorId } from '@/tools/error-extractors'
import type { PitchbookProfileParams, PitchbookResponse } from '@/tools/pitchbook/types'
import { PITCHBOOK_API_BASE, pitchbookAuthHeaders, throwIfNotOk } from '@/tools/pitchbook/utils'
import type { ToolConfig } from '@/tools/types'

export const pitchbookFundCommitmentsTool: ToolConfig<PitchbookProfileParams, PitchbookResponse> = {
  id: 'pitchbook_fund_commitments',
  name: 'PitchBook Fund Commitments',
  description:
    'Retrieve the limited partners committed to a fund, with commitment date, size, status, and type',
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
        'PitchBook fund ID, e.g. 11373-13F. Fund IDs end in F and come from a fund search.',
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
    url: (params) => `${PITCHBOOK_API_BASE}/funds/${params.pbId.trim()}/commitments`,
    method: 'GET',
    headers: (params) => pitchbookAuthHeaders(params.apiKey, params.currency),
  },

  transformResponse: async (response: Response) => {
    await throwIfNotOk(response, 'Failed to fetch fund commitments')
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
      description: 'Limited partner commitments to the fund',
      items: {
        type: 'object',
        properties: {
          fundId: { type: 'string', description: 'PitchBook fund ID' },
          limitedPartnerId: { type: 'string', description: 'PitchBook limited partner ID' },
          limitedPartnerName: { type: 'string', description: 'Limited partner name' },
          commitmentDate: {
            type: 'string',
            description: 'Date of the commitment (YYYY-MM-DD)',
            nullable: true,
          },
          commitmentSize: {
            type: 'json',
            description: 'Size of the commitment, as a PitchBook monetary value',
            nullable: true,
          },
          commitmentStatus: {
            type: 'json',
            description: 'Status of the commitment, as a code and description pair',
            nullable: true,
          },
          commitmentType: {
            type: 'json',
            description: 'Type of the commitment, as a code and description pair',
            nullable: true,
          },
        },
      },
    },
  },
}
