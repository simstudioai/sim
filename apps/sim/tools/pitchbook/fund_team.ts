import { ErrorExtractorId } from '@/tools/error-extractors'
import type { PitchbookProfileParams, PitchbookResponse } from '@/tools/pitchbook/types'
import { PITCHBOOK_API_BASE, pitchbookAuthHeaders, throwIfNotOk } from '@/tools/pitchbook/utils'
import type { ToolConfig } from '@/tools/types'

export const pitchbookFundTeamTool: ToolConfig<PitchbookProfileParams, PitchbookResponse> = {
  id: 'pitchbook_fund_team',
  name: 'PitchBook Fund Team',
  description: 'Retrieve the active and former people on a fund team',
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
      description: 'PitchBook fund ID, e.g. 11373-13F. Fund IDs end in F.',
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
    url: (params) => `${PITCHBOOK_API_BASE}/funds/${params.pbId.trim()}/team`,
    method: 'GET',
    headers: (params) => pitchbookAuthHeaders(params.apiKey, params.currency),
  },

  transformResponse: async (response: Response) => {
    await throwIfNotOk(response, 'Failed to fetch fund team')
    const data = await response.json()

    return {
      success: true,
      output: {
        fundId: data.fundId ?? null,
        investorIds: data.investorIds ?? [],
        countActiveTeam: data.countActiveTeam ?? null,
        active: data.active ?? [],
        former: data.former ?? [],
      },
    }
  },

  outputs: {
    fundId: { type: 'string', description: 'PitchBook fund ID', nullable: true },
    investorIds: {
      type: 'array',
      description: 'PitchBook IDs of the fund managers',
      items: { type: 'string' },
    },
    countActiveTeam: {
      type: 'number',
      description: 'Number of active team members',
      nullable: true,
    },
    active: {
      type: 'array',
      description: 'Active team members',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'PitchBook person ID' },
          name: { type: 'string', description: 'Name' },
          title: { type: 'string', description: 'Title' },
          infoAvailable: {
            type: 'boolean',
            description: 'Whether a full PitchBook profile is available',
          },
        },
      },
    },
    former: {
      type: 'array',
      description: 'Former team members',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'PitchBook person ID' },
          name: { type: 'string', description: 'Name' },
          title: { type: 'string', description: 'Title' },
          infoAvailable: {
            type: 'boolean',
            description: 'Whether a full PitchBook profile is available',
          },
        },
      },
    },
  },
}
