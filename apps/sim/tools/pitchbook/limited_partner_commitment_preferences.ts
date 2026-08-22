import { ErrorExtractorId } from '@/tools/error-extractors'
import type { PitchbookProfileParams, PitchbookResponse } from '@/tools/pitchbook/types'
import { PITCHBOOK_API_BASE, pitchbookAuthHeaders, throwIfNotOk } from '@/tools/pitchbook/utils'
import type { ToolConfig } from '@/tools/types'

export const pitchbookLimitedPartnerCommitmentPreferencesTool: ToolConfig<
  PitchbookProfileParams,
  PitchbookResponse
> = {
  id: 'pitchbook_limited_partner_commitment_preferences',
  name: 'PitchBook Limited Partner Commitment Preferences',
  description:
    'Retrieve what a limited partner commits to: preferred commitment size, fund types, and geographies',
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
      `${PITCHBOOK_API_BASE}/limited-partners/${params.pbId.trim()}/commitment-prefs`,
    method: 'GET',
    headers: (params) => pitchbookAuthHeaders(params.apiKey, params.currency),
  },

  transformResponse: async (response: Response) => {
    await throwIfNotOk(response, 'Failed to fetch limited partner commitment preferences')
    const data = await response.json()

    return {
      success: true,
      output: {
        limitedPartnerId: data.limitedPartnerId ?? null,
        limitedPartnerName: data.limitedPartnerName ?? null,
        preferredCommitmentSize: data.preferredCommitmentSize ?? null,
        preferredGeography: data.preferredGeography ?? [],
        preferredFundTypes: data.preferredFundTypes ?? [],
        preferredDirectInvestmentSize: data.preferredDirectInvestmentSize ?? null,
        otherInvestmentPreferences: data.otherInvestmentPreferences ?? [],
      },
    }
  },

  outputs: {
    limitedPartnerId: {
      type: 'string',
      description: 'PitchBook limited partner ID',
      nullable: true,
    },
    limitedPartnerName: { type: 'string', description: 'Limited partner name', nullable: true },
    preferredCommitmentSize: {
      type: 'json',
      description: 'Preferred commitment size',
      nullable: true,
    },
    preferredGeography: {
      type: 'array',
      description: 'Regions the limited partner targets',
      items: {
        type: 'object',
        properties: {
          code: { type: 'string', description: 'PitchBook code' },
          description: { type: 'string', description: 'Human-readable label for the code' },
        },
      },
    },
    preferredFundTypes: {
      type: 'array',
      description: 'Fund types the limited partner targets',
      items: {
        type: 'object',
        properties: {
          code: { type: 'string', description: 'PitchBook code' },
          description: { type: 'string', description: 'Human-readable label for the code' },
        },
      },
    },
    preferredDirectInvestmentSize: {
      type: 'json',
      description: 'Preferred direct investment size',
      nullable: true,
    },
    otherInvestmentPreferences: {
      type: 'array',
      description: 'Other stated preferences',
      items: { type: 'json' },
    },
  },
}
