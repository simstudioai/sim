import { ErrorExtractorId } from '@/tools/error-extractors'
import type {
  PlaidSearchInstitutionsParams,
  PlaidSearchInstitutionsResponse,
} from '@/tools/plaid/types'
import { PLAID_INSTITUTION_OUTPUT_PROPERTIES } from '@/tools/plaid/types'
import {
  buildPlaidInternalBody,
  mapPlaidInstitution,
  parsePlaidCountryCodes,
  parsePlaidProducts,
  plaidBaseParamFields,
  plaidRecord,
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
      description: "Comma-separated Plaid-supported country codes to search in (defaults to 'US')",
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
    url: '/api/tools/plaid',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) =>
      buildPlaidInternalBody('plaid_search_institutions', params, {
        query: requirePlaidInputString(params.query, 'query'),
        country_codes: parsePlaidCountryCodes(params.countryCodes),
        products: parsePlaidProducts(params.products, 'products'),
      }),
    internalAuth: 'executor_delegation',
  },

  transformResponse: async (response) => {
    const data = await plaidRecord(response, 'institution search')
    const institutions = requirePlaidArrayField(
      data,
      'institutions',
      'institution search.institutions',
      10
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
      items: { type: 'object', properties: PLAID_INSTITUTION_OUTPUT_PROPERTIES },
    },
    count: { type: 'number', description: 'Number of institutions returned' },
  },
}
