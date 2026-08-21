import { ErrorExtractorId } from '@/tools/error-extractors'
import type { PitchbookProfileParams, PitchbookResponse } from '@/tools/pitchbook/types'
import { PITCHBOOK_API_BASE, pitchbookAuthHeaders, throwIfNotOk } from '@/tools/pitchbook/utils'
import type { ToolConfig } from '@/tools/types'

export const pitchbookInvestorBioTool: ToolConfig<PitchbookProfileParams, PitchbookResponse> = {
  id: 'pitchbook_investor_bio',
  name: 'PitchBook Investor Bio',
  description:
    'Retrieve the core profile of an investor: names, description, HQ, type, AUM, dry powder, and headcount',
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
        'PitchBook investor ID, e.g. 58781-35. Use PitchBook Search to resolve a name to an ID.',
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
    url: (params) => `${PITCHBOOK_API_BASE}/investors/${params.pbId.trim()}/bio`,
    method: 'GET',
    headers: (params) => pitchbookAuthHeaders(params.apiKey, params.currency),
  },

  transformResponse: async (response: Response) => {
    await throwIfNotOk(response, 'Failed to fetch investor bio')
    const data = await response.json()

    return {
      success: true,
      output: {
        investorId: data.investorId ?? null,
        investorName: data.investorName ?? null,
        hqLocation: data.hqLocation ?? null,
        description: data.description ?? null,
        investorStatus: data.investorStatus ?? null,
        assetsUnderManagement: data.assetsUnderManagement ?? null,
        dryPowder: data.dryPowder ?? null,
        yearFounded: data.yearFounded ?? null,
        website: data.website ?? null,
        countInvestmentProfessionals: data.countInvestmentProfessionals ?? null,
        investorType: data.investorType ?? [],
        tradeAssociations: data.tradeAssociations ?? [],
      },
    }
  },

  outputs: {
    investorId: { type: 'string', description: 'PitchBook investor ID', nullable: true },
    investorName: {
      type: 'object',
      description: 'The names the investor is known by',
      properties: {
        formalName: { type: 'string', description: 'Formal name', nullable: true },
        alsoKnownAs: { type: 'string', description: 'Also-known-as name', nullable: true },
        legalName: { type: 'string', description: 'Registered legal name', nullable: true },
        formerlyKnownAs: { type: 'string', description: 'Previous name', nullable: true },
      },
    },
    hqLocation: {
      type: 'object',
      description: 'Headquarters location',
      nullable: true,
      properties: {
        city: { type: 'string', description: 'City', nullable: true },
        stateProvince: { type: 'string', description: 'State or province', nullable: true },
        postCode: { type: 'string', description: 'Postal code', nullable: true },
        country: { type: 'string', description: 'Country', nullable: true },
      },
    },
    description: {
      type: 'object',
      description: 'Investor description in brief and full form',
      nullable: true,
      properties: {
        brief: { type: 'string', description: 'Short description', nullable: true },
        full: { type: 'string', description: 'Full description', nullable: true },
      },
    },
    investorStatus: {
      type: 'object',
      description: 'Whether the investor is actively investing',
      nullable: true,
      properties: {
        code: { type: 'string', description: 'PitchBook code', nullable: true },
        description: {
          type: 'string',
          description: 'Human-readable label for the code',
          nullable: true,
        },
      },
    },
    investorType: {
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
    assetsUnderManagement: {
      type: 'object',
      description: 'Assets under management',
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
    dryPowder: {
      type: 'object',
      description: 'Uncalled capital available to deploy',
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
    yearFounded: { type: 'number', description: 'Year the investor was founded', nullable: true },
    website: { type: 'string', description: 'Investor website', nullable: true },
    countInvestmentProfessionals: {
      type: 'number',
      description: 'Number of investment professionals on staff',
      nullable: true,
    },
    tradeAssociations: {
      type: 'array',
      description: 'Trade associations the investor belongs to',
      items: { type: 'object' },
    },
  },
}
