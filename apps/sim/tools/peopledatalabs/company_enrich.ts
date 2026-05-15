import type { PdlCompanyEnrichParams, PdlCompanyEnrichResponse } from '@/tools/peopledatalabs/types'
import { PDL_COMPANY_OUTPUT_PROPERTIES } from '@/tools/peopledatalabs/types'
import { buildQueryString, projectCompany } from '@/tools/peopledatalabs/utils'
import type { ToolConfig } from '@/tools/types'

export const companyEnrichTool: ToolConfig<PdlCompanyEnrichParams, PdlCompanyEnrichResponse> = {
  id: 'pdl_company_enrich',
  name: 'PDL Company Enrich',
  description:
    'Enrich a single company using People Data Labs. Match by name, website, LinkedIn URL, ticker, or PDL ID.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'People Data Labs API key',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Company name',
    },
    website: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Company website domain',
    },
    profile: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'LinkedIn company URL',
    },
    ticker: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Stock ticker',
    },
    pdl_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'PDL company ID',
    },
    location: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Company location (helps disambiguate)',
    },
    locality: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'City',
    },
    region: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'State/region',
    },
    country: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Country',
    },
    min_likelihood: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Minimum match likelihood (1-10)',
    },
    required: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Required-fields expression',
    },
    titlecase: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Return name fields in title case',
    },
  },

  request: {
    url: (params) => {
      const qs = buildQueryString({
        name: params.name,
        website: params.website,
        profile: params.profile,
        ticker: params.ticker,
        pdl_id: params.pdl_id,
        location: params.location,
        locality: params.locality,
        region: params.region,
        country: params.country,
        min_likelihood: params.min_likelihood,
        required: params.required,
        titlecase: params.titlecase,
      })
      return `https://api.peopledatalabs.com/v5/company/enrich${qs}`
    },
    method: 'GET',
    headers: (params) => ({
      'X-Api-Key': params.apiKey,
      Accept: 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = (await response.json()) as Record<string, unknown>
    const status = (data.status as number) ?? response.status

    if (status === 404) {
      return { success: true, output: { matched: false, likelihood: null, company: null } }
    }

    if (!response.ok) {
      const error = (data.error as { message?: string })?.message
      throw new Error(error || `People Data Labs error: ${response.status}`)
    }

    const hasFields = data.name || data.website || data.id
    return {
      success: true,
      output: {
        matched: Boolean(hasFields),
        likelihood: (data.likelihood as number) ?? null,
        company: hasFields ? projectCompany(data) : null,
      },
    }
  },

  outputs: {
    matched: { type: 'boolean', description: 'Whether a company record was matched' },
    likelihood: {
      type: 'number',
      description: 'Match likelihood score (1-10), null if no match',
      optional: true,
    },
    company: {
      type: 'object',
      description: 'Matched company record',
      optional: true,
      properties: PDL_COMPANY_OUTPUT_PROPERTIES,
    },
  },
}
