import { ErrorExtractorId } from '@/tools/error-extractors'
import type { PitchbookProfileParams, PitchbookResponse } from '@/tools/pitchbook/types'
import { PITCHBOOK_API_BASE, pitchbookAuthHeaders, throwIfNotOk } from '@/tools/pitchbook/utils'
import type { ToolConfig } from '@/tools/types'

export const pitchbookInvestorPreferencesTool: ToolConfig<
  PitchbookProfileParams,
  PitchbookResponse
> = {
  id: 'pitchbook_investor_preferences',
  name: 'PitchBook Investor Preferences',
  description:
    'Retrieve what an investor targets: check size, deal size, valuation, revenue, geography, industry, and deal type preferences',
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
    url: (params) => `${PITCHBOOK_API_BASE}/investors/${params.pbId.trim()}/investment-preferences`,
    method: 'GET',
    headers: (params) => pitchbookAuthHeaders(params.apiKey, params.currency),
  },

  transformResponse: async (response: Response) => {
    await throwIfNotOk(response, 'Failed to fetch investor preferences')
    const data = await response.json()

    return {
      success: true,
      output: {
        investorId: data.investorId ?? null,
        investorName: data.investorName ?? null,
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
    investorId: { type: 'string', description: 'PitchBook investor ID', nullable: true },
    investorName: { type: 'string', description: 'Investor name', nullable: true },
    preferredInvestmentAmount: {
      type: 'object',
      description: 'Preferred check size, as a min and max monetary value',
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
    preferredDealSize: {
      type: 'object',
      description: 'Preferred total deal size, as a min and max monetary value',
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
    preferredCompanyValuation: {
      type: 'object',
      description: 'Preferred company valuation, as a min and max monetary value',
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
    preferredEbitda: {
      type: 'object',
      description: 'Preferred EBITDA, as a min and max monetary value',
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
    preferredEbit: {
      type: 'object',
      description: 'Preferred EBIT, as a min and max monetary value',
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
    preferredRevenue: {
      type: 'object',
      description: 'Preferred revenue, as a min and max monetary value',
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
    preferredInvestmentHorizon: {
      type: 'object',
      description: 'Preferred holding period in years',
      nullable: true,
      properties: {
        min: { type: 'number', description: 'Minimum years', nullable: true },
        max: { type: 'number', description: 'Maximum years', nullable: true },
      },
    },
    geographicalPreferences: {
      type: 'array',
      description: 'Regions the investor targets, from broad group down to state',
      items: {
        type: 'object',
        properties: {
          regionGroup: { type: 'json', description: 'Broad region as a code and description pair' },
          regionSegment: {
            type: 'json',
            description: 'Region segment as a code and description pair',
          },
          regionCode: { type: 'json', description: 'Country as a code and description pair' },
          regionState: {
            type: 'json',
            description: 'State or province as a code and description pair',
          },
        },
      },
    },
    otherInvestmentPreferences: {
      type: 'array',
      description: 'Other stated preferences, such as preferring a minority stake',
      items: {
        type: 'object',
        properties: {
          code: { type: 'string', description: 'Preference code' },
          description: { type: 'string', description: 'Preference label' },
        },
      },
    },
    preferredIndustry: {
      type: 'array',
      description: 'Industries the investor targets',
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
              code: { type: 'string', description: 'Sector code' },
              description: { type: 'string', description: 'Sector label' },
            },
          },
          industryGroup: {
            type: 'object',
            description: 'Industry group within the sector',
            properties: {
              code: { type: 'string', description: 'Group code' },
              description: { type: 'string', description: 'Group label' },
            },
          },
          primary: { type: 'boolean', description: 'Whether this is the primary industry' },
        },
      },
    },
    preferredDealTypes: {
      type: 'array',
      description: 'Deal types the investor targets',
      items: {
        type: 'object',
        properties: {
          code: { type: 'string', description: 'Deal type code' },
          description: { type: 'string', description: 'Deal type label' },
        },
      },
    },
    preferredVerticals: {
      type: 'array',
      description: 'Verticals the investor targets',
      items: {
        type: 'object',
        properties: {
          code: { type: 'string', description: 'Vertical code' },
          description: { type: 'string', description: 'Vertical label' },
        },
      },
    },
    assetPreferences: {
      type: 'array',
      description: 'Asset classes and subcategories the investor targets',
      items: {
        type: 'object',
        properties: {
          assetClass: { type: 'json', description: 'Asset class as a code and description pair' },
          subcategory: { type: 'json', description: 'Subcategory as a code and description pair' },
        },
      },
    },
  },
}
