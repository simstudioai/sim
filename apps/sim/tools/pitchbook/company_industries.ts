import { ErrorExtractorId } from '@/tools/error-extractors'
import type { PitchbookProfileParams, PitchbookResponse } from '@/tools/pitchbook/types'
import { PITCHBOOK_API_BASE, pitchbookAuthHeaders, throwIfNotOk } from '@/tools/pitchbook/utils'
import type { ToolConfig } from '@/tools/types'

export const pitchbookCompanyIndustriesTool: ToolConfig<PitchbookProfileParams, PitchbookResponse> =
  {
    id: 'pitchbook_company_industries',
    name: 'PitchBook Company Industries',
    description:
      'Retrieve the industry classification, verticals, keywords, and emerging spaces assigned to a company',
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
      url: (params) => `${PITCHBOOK_API_BASE}/companies/${params.pbId.trim()}/industries`,
      method: 'GET',
      headers: (params) => pitchbookAuthHeaders(params.apiKey, params.currency),
    },

    transformResponse: async (response: Response) => {
      await throwIfNotOk(response, 'Failed to fetch company industries')
      const data = await response.json()

      return {
        success: true,
        output: {
          companyId: data.companyId ?? null,
          industries: data.industries ?? [],
          verticals: data.verticals ?? [],
          keywords: data.keywords ?? [],
          emergingSpaces: data.emergingSpaces ?? [],
        },
      }
    },

    outputs: {
      companyId: { type: 'string', description: 'PitchBook company ID' },
      industries: {
        type: 'array',
        description: 'Industry classifications, most specific first. One entry is flagged primary.',
        items: {
          type: 'object',
          properties: {
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
            industryCode: {
              type: 'object',
              description: 'Most specific industry classification',
              properties: {
                code: { type: 'string', description: 'Industry code' },
                description: { type: 'string', description: 'Industry label' },
              },
            },
            primary: { type: 'boolean', description: 'Whether this is the primary industry' },
          },
        },
      },
      verticals: {
        type: 'array',
        description: 'Verticals the company operates in',
        items: {
          type: 'object',
          properties: {
            code: { type: 'string', description: 'Vertical code' },
            description: { type: 'string', description: 'Vertical label' },
          },
        },
      },
      keywords: {
        type: 'array',
        description: 'Keywords associated with the company',
        items: { type: 'string', description: 'Keyword' },
      },
      /**
       * The recorded sample is an empty array and PitchBook does not publish the
       * entry shape anywhere in the collection, so the items stay opaque rather
       * than borrowing the sibling `verticals` shape.
       */
      emergingSpaces: {
        type: 'array',
        description: 'Analyst-defined emerging spaces the company is placed in',
        items: { type: 'json' },
      },
    },
  }
