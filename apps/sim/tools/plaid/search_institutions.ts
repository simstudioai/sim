import { ErrorExtractorId } from '@/tools/error-extractors'
import type {
  PlaidSearchInstitutionsParams,
  PlaidSearchInstitutionsResponse,
} from '@/tools/plaid/types'
import {
  buildPlaidHeaders,
  mapPlaidInstitution,
  plaidBaseParamFields,
  plaidBody,
  plaidInstitutionOutputProperties,
  plaidRecord,
  plaidUrl,
  splitPlaidList,
} from '@/tools/plaid/utils'
import type { ToolConfig } from '@/tools/types'

export const plaidSearchInstitutionsTool: ToolConfig<
  PlaidSearchInstitutionsParams,
  PlaidSearchInstitutionsResponse
> = {
  id: 'plaid_search_institutions',
  name: 'Plaid Search Institutions',
  description: 'Search financial institutions supported by Plaid by name',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.PLAID_ERRORS,

  params: {
    ...plaidBaseParamFields,
    query: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: "Institution name to search for, e.g. 'Chase'",
    },
    countryCodes: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: "Comma-separated ISO country codes to search in (defaults to 'US')",
    },
    products: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        "Comma-separated products the institutions must support, e.g. 'transactions,auth'",
    },
  },

  request: {
    url: (params) => plaidUrl(params, '/institutions/search'),
    method: 'POST',
    headers: (params) => buildPlaidHeaders(params),
    body: (params) =>
      plaidBody({
        query: params.query.trim(),
        country_codes: splitPlaidList(params.countryCodes) ?? ['US'],
        products: splitPlaidList(params.products),
        options: { include_optional_metadata: true },
      }),
  },

  transformResponse: async (response) => {
    const data = await plaidRecord(response, 'institution search')
    const institutions = Array.isArray(data.institutions) ? data.institutions : []
    const mapped = institutions.map(mapPlaidInstitution)
    return {
      success: true,
      output: {
        institutions: mapped,
        count: mapped.length,
      },
    }
  },

  outputs: {
    institutions: {
      type: 'array',
      description: 'Institutions matching the search',
      items: { type: 'json', properties: plaidInstitutionOutputProperties },
    },
    count: { type: 'number', description: 'Number of institutions returned' },
  },
}
