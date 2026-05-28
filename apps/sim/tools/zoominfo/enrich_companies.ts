import type { ToolConfig } from '@/tools/types'
import type {
  ZoomInfoEnrichCompaniesParams,
  ZoomInfoEnrichCompaniesResponse,
} from '@/tools/zoominfo/types'
import {
  buildProxyBody,
  extractDataArray,
  parseCsvOrJson,
  parseJsonField,
  transformZoomInfoEnvelope,
  ZOOMINFO_PROXY_URL,
} from '@/tools/zoominfo/utils'

/**
 * Default output fields used when the caller does not specify any. ZoomInfo's
 * CompanyEnrich schema requires `outputFields`, so we send a useful firmographic
 * set rather than letting the request fail. All values are valid CompanyEnrich fields.
 */
const DEFAULT_COMPANY_OUTPUT_FIELDS = [
  'id',
  'name',
  'website',
  'domainList',
  'ticker',
  'revenue',
  'revenueRange',
  'employeeCount',
  'employeeRange',
  'primaryIndustry',
  'industries',
  'street',
  'city',
  'state',
  'zipCode',
  'country',
  'phone',
  'foundedYear',
  'companyStatus',
  'socialMediaUrls',
  'logo',
  'description',
]

export const zoominfoEnrichCompaniesTool: ToolConfig<
  ZoomInfoEnrichCompaniesParams,
  ZoomInfoEnrichCompaniesResponse
> = {
  id: 'zoominfo_enrich_companies',
  name: 'ZoomInfo Enrich Companies',
  description:
    'Enrich up to 25 companies in one request with detailed firmographics, industry, financials, and more.',
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
    matchCompanyInput: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'JSON array (1-25 items) of company matching criteria, e.g. [{"companyName":"Acme","companyWebsite":"acme.com"}]',
    },
    outputFields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'JSON array or comma-separated list of fields to return (e.g. ["id","name","website","revenue","employeeCount"]). Defaults to a standard firmographic set if omitted.',
    },
  },

  request: {
    url: ZOOMINFO_PROXY_URL,
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => {
      const matchCompanyInput = parseJsonField<unknown>(
        params.matchCompanyInput,
        'matchCompanyInput'
      )
      if (!Array.isArray(matchCompanyInput) || matchCompanyInput.length === 0) {
        throw new Error('matchCompanyInput must be a non-empty JSON array')
      }
      if (matchCompanyInput.length > 25) {
        throw new Error('matchCompanyInput supports a maximum of 25 entries per request')
      }

      const outputFields = parseCsvOrJson(params.outputFields, 'outputFields')
      const attributes: Record<string, unknown> = {
        matchCompanyInput,
        outputFields: outputFields ?? DEFAULT_COMPANY_OUTPUT_FIELDS,
      }

      return {
        ...buildProxyBody(params),
        path: '/data/v1/companies/enrich',
        method: 'POST',
        body: {
          data: {
            type: 'CompanyEnrich',
            attributes,
          },
        },
      }
    },
  },

  transformResponse: async (response: Response) => {
    const { data } = await transformZoomInfoEnvelope(response)
    const results = extractDataArray(data)
    return {
      success: true,
      output: { results },
    }
  },

  outputs: {
    results: {
      type: 'array',
      description: 'Enrichment results, one per input with match status and attributes',
      items: { type: 'json' },
    },
  },
}
