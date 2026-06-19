import {
  API_BASE,
  authHeaders,
  type DataForB2BEnrichCompanyParams,
  type DataForB2BEnrichCompanyResponse,
} from '@/tools/dataforb2b/types'
import type { ToolConfig } from '@/tools/types'

export const dataforb2bEnrichCompanyTool: ToolConfig<
  DataForB2BEnrichCompanyParams,
  DataForB2BEnrichCompanyResponse
> = {
  id: 'dataforb2b_enrich_company',
  name: 'DataForB2B Enrich Company',
  description:
    'Look up and enrich a company with DataForB2B from a company domain, name, slug or LinkedIn URL. Returns firmographics, headcount/size, industry, domain and social profiles. Account enrichment for B2B sales and CRM.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'DataForB2B API key (https://app.dataforb2b.ai)',
    },
    company_identifier: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Company slug (e.g. google), domain (e.g. google.com), name or LinkedIn company URL. Slugs resolve most reliably.',
    },
  },

  request: {
    url: `${API_BASE}/enrich/company`,
    method: 'POST',
    headers: (params) => authHeaders(params.apiKey),
    body: (params) => ({ company_identifier: params.company_identifier }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`DataForB2B API error: ${response.status} - ${errorText}`)
    }
    const data = await response.json()
    // The API wraps the result as { company: {...} }.
    return {
      success: true,
      output: {
        company: data.company ?? data,
      },
    }
  },

  outputs: {
    company: {
      type: 'json',
      description:
        'Enriched company: name, domain, industry, headcount/size, location, founded year, funding and social profiles',
    },
  },
}
