import { ErrorExtractorId } from '@/tools/error-extractors'
import type { PitchbookProfileParams, PitchbookResponse } from '@/tools/pitchbook/types'
import { PITCHBOOK_API_BASE, pitchbookAuthHeaders, throwIfNotOk } from '@/tools/pitchbook/utils'
import type { ToolConfig } from '@/tools/types'

export const pitchbookFundInvestmentPreferencesTool: ToolConfig<
  PitchbookProfileParams,
  PitchbookResponse
> = {
  id: 'pitchbook_fund_investment_preferences',
  name: 'PitchBook Fund Investment Preferences',
  description:
    'Retrieve what a fund targets: check size, valuation, geography, industry, vertical, and deal type preferences',
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
    url: (params) => `${PITCHBOOK_API_BASE}/funds/${params.pbId.trim()}/investment-preferences`,
    method: 'GET',
    headers: (params) => pitchbookAuthHeaders(params.apiKey, params.currency),
  },

  transformResponse: async (response: Response) => {
    await throwIfNotOk(response, 'Failed to fetch fund investment preferences')
    const data = await response.json()

    return {
      success: true,
      output: {
        fundId: data.fundId ?? null,
        preferredInvestmentAmount: data.preferredInvestmentAmount ?? null,
        preferredDealSize: data.preferredDealSize ?? null,
        preferredCompanyValuation: data.preferredCompanyValuation ?? null,
        preferredEbitda: data.preferredEbitda ?? null,
        preferredEbit: data.preferredEbit ?? null,
        preferredRevenue: data.preferredRevenue ?? null,
        preferredInvestmentHorizon: data.preferredInvestmentHorizon ?? null,
        geographicalPreferences: data.geographicalPreferences ?? [],
        otherInvestmentPreferences: data.otherInvestmentPreferences ?? [],
        preferredIndustry: data.preferredIndustry ?? [],
        preferredDealTypes: data.preferredDealTypes ?? [],
        preferredVerticals: data.preferredVerticals ?? [],
        assetPreferences: data.assetPreferences ?? [],
      },
    }
  },

  outputs: {
    fundId: { type: 'string', description: 'PitchBook fund ID', nullable: true },
    preferredInvestmentAmount: {
      type: 'json',
      description: 'Preferred check size',
      nullable: true,
    },
    preferredDealSize: { type: 'json', description: 'Preferred deal size', nullable: true },
    preferredCompanyValuation: {
      type: 'json',
      description: 'Preferred company valuation',
      nullable: true,
    },
    preferredEbitda: { type: 'json', description: 'Preferred EBITDA', nullable: true },
    preferredEbit: { type: 'json', description: 'Preferred EBIT', nullable: true },
    preferredRevenue: { type: 'json', description: 'Preferred revenue', nullable: true },
    preferredInvestmentHorizon: {
      type: 'json',
      description: 'Preferred holding period in years',
      nullable: true,
    },
    geographicalPreferences: {
      type: 'array',
      description: 'Regions targeted',
      items: {
        type: 'object',
        properties: {
          regionGroup: {
            type: 'object',
            description: 'Broad region as a code and description pair',
            properties: {
              code: { type: 'string', description: 'PitchBook code' },
              description: { type: 'string', description: 'Human-readable label for the code' },
            },
          },
          regionSegment: {
            type: 'object',
            description: 'Region segment as a code and description pair',
            properties: {
              code: { type: 'string', description: 'PitchBook code' },
              description: { type: 'string', description: 'Human-readable label for the code' },
            },
          },
          regionCode: {
            type: 'object',
            description: 'Country as a code and description pair',
            properties: {
              code: { type: 'string', description: 'PitchBook code' },
              description: { type: 'string', description: 'Human-readable label for the code' },
            },
          },
          regionState: {
            type: 'json',
            description: 'State or province as a code and description pair',
            nullable: true,
          },
        },
      },
    },
    otherInvestmentPreferences: {
      type: 'array',
      description: 'Other stated preferences',
      items: {
        type: 'object',
        properties: {
          code: { type: 'string', description: 'PitchBook code' },
          description: { type: 'string', description: 'Human-readable label for the code' },
        },
      },
    },
    preferredIndustry: {
      type: 'array',
      description: 'Industries targeted',
      items: {
        type: 'object',
        properties: {
          industryCode: {
            type: 'json',
            description: 'Most specific industry classification',
            nullable: true,
          },
          industrySector: {
            type: 'object',
            description: 'Top-level sector',
            properties: {
              description: { type: 'string', description: 'Human-readable label for the code' },
              code: { type: 'string', description: 'PitchBook code' },
            },
          },
          industryGroup: {
            type: 'object',
            description: 'Industry group within the sector',
            properties: {
              description: { type: 'string', description: 'Human-readable label for the code' },
              code: { type: 'string', description: 'PitchBook code' },
            },
          },
          primary: { type: 'boolean', description: 'Whether this is the primary entry' },
        },
      },
    },
    preferredDealTypes: {
      type: 'array',
      description: 'Deal types targeted',
      items: {
        type: 'object',
        properties: {
          code: { type: 'string', description: 'PitchBook code' },
          description: { type: 'string', description: 'Human-readable label for the code' },
        },
      },
    },
    preferredVerticals: {
      type: 'array',
      description: 'Verticals targeted',
      items: {
        type: 'object',
        properties: {
          code: { type: 'string', description: 'PitchBook code' },
          description: { type: 'string', description: 'Human-readable label for the code' },
        },
      },
    },
    assetPreferences: {
      type: 'array',
      description: 'Asset classes and subcategories targeted',
      items: { type: 'json' },
    },
  },
}
