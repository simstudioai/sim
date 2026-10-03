import type { InternalToolConfig } from '@/tools/types'
import type {
  ZoomInfoSearchCompaniesParams,
  ZoomInfoSearchCompaniesResponse,
} from '@/tools/zoominfo/types'
import {
  extractDataArray,
  extractPagination,
  paginationOutputProperties,
  transformZoomInfoResponse,
} from '@/tools/zoominfo/utils'

export const zoominfoSearchCompaniesTool: InternalToolConfig<
  ZoomInfoSearchCompaniesParams,
  ZoomInfoSearchCompaniesResponse
> = {
  id: 'zoominfo_search_companies',
  name: 'ZoomInfo Search Companies',
  description: 'Search the ZoomInfo company database by name, industry, location, and size.',
  version: '1.0.0',

  params: {
    clientId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'ZoomInfo OAuth client ID',
    },
    clientSecret: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'ZoomInfo OAuth client secret',
    },
    companyName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Company name to search for',
    },
    companyWebsite: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Company website (comma-separated for multiple)',
    },
    companyTicker: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Stock ticker symbols — JSON array, comma-separated list, or single ticker. Sent to the API as an array.',
    },
    industryCodes: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Industry codes — JSON array or comma-separated list. Sent to the API as a comma-separated string.',
    },
    country: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Country name',
    },
    state: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'State or province',
    },
    metroRegion: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'US/Canada metro region',
    },
    revenueMin: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Minimum annual revenue in thousands USD',
    },
    revenueMax: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum annual revenue in thousands USD',
    },
    employeeRangeMin: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Minimum employee count',
    },
    employeeRangeMax: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum employee count',
    },
    excludeDefunctCompanies: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Exclude inactive companies',
    },
    page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page number (1-based)',
    },
    rpp: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Results per page (1-100, default 25)',
    },
    sortBy: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Field to sort by',
    },
    sortOrder: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort order (asc or desc)',
    },
  },

  operation: {
    input: (params) => params,
  },

  transformResponse: async (response: Response) => {
    const { data } = await transformZoomInfoResponse(response)
    const companies = extractDataArray(data)
    const pagination = extractPagination(data)
    return {
      success: true,
      output: {
        companies,
        ...pagination,
      },
    }
  },

  outputs: {
    companies: {
      type: 'array',
      description: 'Matching companies',
      items: { type: 'json' },
    },
    ...paginationOutputProperties,
  },
}
