import { ErrorExtractorId } from '@/tools/error-extractors'
import type { PitchbookProfileParams, PitchbookResponse } from '@/tools/pitchbook/types'
import { PITCHBOOK_API_BASE, pitchbookAuthHeaders, throwIfNotOk } from '@/tools/pitchbook/utils'
import type { ToolConfig } from '@/tools/types'

export const pitchbookFundBioTool: ToolConfig<PitchbookProfileParams, PitchbookResponse> = {
  id: 'pitchbook_fund_bio',
  name: 'PitchBook Fund Bio',
  description:
    'Retrieve the profile of a fund: managers, vintage, status, type, size, target, location, and team',
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
    url: (params) => `${PITCHBOOK_API_BASE}/funds/${params.pbId.trim()}/bio`,
    method: 'GET',
    headers: (params) => pitchbookAuthHeaders(params.apiKey, params.currency),
  },

  transformResponse: async (response: Response) => {
    await throwIfNotOk(response, 'Failed to fetch fund bio')
    const data = await response.json()

    return {
      success: true,
      output: {
        fundId: data.fundId ?? null,
        name: data.name ?? null,
        fundInvestors: data.fundInvestors ?? [],
        vintage: data.vintage ?? null,
        fundStatus: data.fundStatus ?? null,
        fundType: data.fundType ?? null,
        fundSize: data.fundSize ?? null,
        location: data.location ?? null,
        fundTeam: data.fundTeam ?? [],
        openDate: data.openDate ?? null,
        closeDate: data.closeDate ?? null,
        fundTargetSize: data.fundTargetSize ?? null,
        sbic: data.sbic ?? false,
        returnsInfoAvailable: data.returnsInfoAvailable ?? [],
      },
    }
  },

  outputs: {
    fundId: { type: 'string', description: 'PitchBook fund ID', nullable: true },
    name: { type: 'string', description: 'Fund name', nullable: true },
    fundInvestors: {
      type: 'array',
      description: 'Managers of the fund, with where it sits in their fund series',
      items: {
        type: 'object',
        properties: {
          investorId: { type: 'string', description: 'PitchBook investor ID' },
          investorName: { type: 'string', description: 'Investor name' },
          fundNo: {
            type: 'number',
            description: 'Position in the manager fund series',
            nullable: true,
          },
          firstFund: { type: 'boolean', description: 'Whether this is the manager first fund' },
        },
      },
    },
    vintage: { type: 'number', description: 'Vintage year of the fund', nullable: true },
    fundStatus: {
      type: 'string',
      description: 'Whether the fund is open or closed',
      nullable: true,
    },
    fundType: { type: 'string', description: 'Type of the fund', nullable: true },
    fundSize: {
      type: 'object',
      description: 'Capital raised by the fund',
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
    location: {
      type: 'object',
      description: 'Office the fund is run from',
      nullable: true,
      properties: {
        location: { type: 'string', description: 'Office label', nullable: true },
        addressLine1: { type: 'string', description: 'Address line 1', nullable: true },
        addressLine2: { type: 'string', description: 'Address line 2', nullable: true },
        city: { type: 'string', description: 'City', nullable: true },
        stateProvince: { type: 'string', description: 'State or province', nullable: true },
        postCode: { type: 'string', description: 'Postal code', nullable: true },
        country: { type: 'string', description: 'Country', nullable: true },
        phone: { type: 'string', description: 'Phone number', nullable: true },
        fax: { type: 'string', description: 'Fax number', nullable: true },
        email: { type: 'string', description: 'Email address', nullable: true },
        globalRegion: { type: 'string', description: 'Global region', nullable: true },
        globalSubRegion: { type: 'string', description: 'Global sub-region', nullable: true },
      },
    },
    fundTeam: {
      type: 'array',
      description: 'People on the fund team',
      items: {
        type: 'object',
        properties: {
          personId: { type: 'string', description: 'PitchBook person ID' },
          personFullName: { type: 'string', description: 'Full name of the person' },
        },
      },
    },
    openDate: { type: 'string', description: 'Date the fund opened (YYYY-MM-DD)', nullable: true },
    closeDate: { type: 'string', description: 'Date the fund closed (YYYY-MM-DD)', nullable: true },
    fundTargetSize: {
      type: 'object',
      description: 'Target raise for the fund, as a min and max monetary value',
      nullable: true,
      properties: {
        min: {
          type: 'json',
          description: 'Minimum, as a PitchBook monetary value',
          nullable: true,
        },
        max: {
          type: 'json',
          description: 'Maximum, as a PitchBook monetary value',
          nullable: true,
        },
      },
    },
    sbic: {
      type: 'boolean',
      description: 'Whether the fund is a Small Business Investment Company',
    },
    returnsInfoAvailable: {
      type: 'array',
      description: 'Which returns datasets are available for the fund',
      items: { type: 'object' },
    },
  },
}
