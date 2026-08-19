import { ErrorExtractorId } from '@/tools/error-extractors'
import type {
  PlaidSearchInstitutionsParams,
  PlaidSearchInstitutionsResponse,
} from '@/tools/plaid/types'
import {
  buildPlaidHeaders,
  mapPlaidInstitution,
  parsePlaidCountryCodes,
  parsePlaidProducts,
  plaidBaseParamFields,
  plaidBody,
  plaidInstitutionOutputProperties,
  plaidRecord,
  plaidUrl,
  requirePlaidArrayField,
  requirePlaidInputString,
} from '@/tools/plaid/utils'
import type { ToolConfig } from '@/tools/types'

export const plaidSearchInstitutionsTool: ToolConfig<
  PlaidSearchInstitutionsParams,
  PlaidSearchInstitutionsResponse
> = {
  id: 'plaid_search_institutions',
  name: 'Plaid Search Institutions',
  description: 'Search financial institutions supported by Plaid by name, returning at most 10',
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
        query: requirePlaidInputString(params.query, 'query'),
        country_codes: parsePlaidCountryCodes(params.countryCodes),
        products: parsePlaidProducts(params.products, 'products', {
          allowIncomeVerification: true,
        }),
        options: { include_optional_metadata: true },
      }),
  },

  transformResponse: async (response) => {
    const data = await plaidRecord(response, 'institution search')
    const institutions = requirePlaidArrayField(
      data,
      'institutions',
      'institution search.institutions'
    )
    const mapped = institutions.map((institution, index) =>
      mapPlaidInstitution(institution, `institution search.institutions[${index}]`)
    )
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
      items: { type: 'object', properties: plaidInstitutionOutputProperties },
    },
    count: { type: 'number', description: 'Number of institutions returned' },
  },
}
