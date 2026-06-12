import type { ToolConfig } from '@/tools/types'
import type {
  ZoomInfoSearchCompaniesParams,
  ZoomInfoSearchCompaniesResponse,
} from '@/tools/zoominfo/types'
import {
  buildProxyBody,
  extractDataArray,
  extractPagination,
  paginationOutputProperties,
  parseCsvOrJson,
  toCsvStringOrUndefined,
  toNumberOrUndefined,
  transformZoomInfoEnvelope,
  ZOOMINFO_PROXY_URL,
} from '@/tools/zoominfo/utils'

export const zoominfoSearchCompaniesTool: ToolConfig<
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

  request: {
    url: ZOOMINFO_PROXY_URL,
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => {
      const attributes: Record<string, unknown> = {}
      if (params.companyName) attributes.companyName = params.companyName
      if (params.companyWebsite) attributes.companyWebsite = params.companyWebsite
      const companyTicker = parseCsvOrJson(params.companyTicker, 'companyTicker')
      if (companyTicker) attributes.companyTicker = companyTicker
      const industryCodes = toCsvStringOrUndefined(params.industryCodes, 'industryCodes')
      if (industryCodes) attributes.industryCodes = industryCodes
      if (params.country) attributes.country = params.country
      if (params.state) attributes.state = params.state
      if (params.metroRegion) attributes.metroRegion = params.metroRegion
      const revenueMin = toNumberOrUndefined(params.revenueMin)
      if (revenueMin !== undefined) attributes.revenueMin = revenueMin
      const revenueMax = toNumberOrUndefined(params.revenueMax)
      if (revenueMax !== undefined) attributes.revenueMax = revenueMax
      const employeeRangeMin = toNumberOrUndefined(params.employeeRangeMin)
      if (employeeRangeMin !== undefined) attributes.employeeRangeMin = String(employeeRangeMin)
      const employeeRangeMax = toNumberOrUndefined(params.employeeRangeMax)
      if (employeeRangeMax !== undefined) attributes.employeeRangeMax = String(employeeRangeMax)
      if (params.excludeDefunctCompanies !== undefined) {
        attributes.excludeDefunctCompanies = params.excludeDefunctCompanies
      }

      const query: Record<string, string | number> = {}
      const page = toNumberOrUndefined(params.page)
      const rpp = toNumberOrUndefined(params.rpp)
      if (page !== undefined) query['page[number]'] = page
      if (rpp !== undefined) query['page[size]'] = rpp
      if (params.sortBy) {
        const order = params.sortOrder === 'desc' ? '-' : ''
        query.sort = `${order}${params.sortBy}`
      }

      return {
        ...buildProxyBody(params),
        path: '/data/v1/companies/search',
        method: 'POST',
        query: Object.keys(query).length > 0 ? query : undefined,
        body: {
          data: {
            type: 'CompanySearch',
            attributes,
          },
        },
      }
    },
  },

  transformResponse: async (response: Response) => {
    const { data } = await transformZoomInfoEnvelope(response)
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
