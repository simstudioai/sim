import { prospeoHosting } from '@/tools/prospeo/hosting'
import {
  extractProspeoError,
  type ProspeoEnrichCompanyParams,
  type ProspeoEnrichCompanyResponse,
} from '@/tools/prospeo/types'
import type { ToolConfig } from '@/tools/types'

export const enrichCompanyTool: ToolConfig<
  ProspeoEnrichCompanyParams,
  ProspeoEnrichCompanyResponse
> = {
  id: 'prospeo_enrich_company',
  name: 'Prospeo Enrich Company',
  description: 'Enrich a company with complete B2B data.',
  version: '1.0.0',

  hosting: prospeoHosting<ProspeoEnrichCompanyParams>((_params, output) => {
    // 1 credit per company match; no charge on a no-match or repeat enrichment.
    if (output.free_enrichment === true) return 0
    return output.company ? 1 : 0
  }),

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Prospeo API key',
    },
    company_website: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Company website (e.g., "intercom.com")',
    },
    company_linkedin_url: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: "Company's public LinkedIn URL",
    },
    company_name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Company name (use combined with website for best accuracy)',
    },
    company_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Prospeo company_id from a previously enriched company',
    },
  },

  request: {
    url: 'https://api.prospeo.io/enrich-company',
    method: 'POST',
    headers: (params) => ({
      'X-KEY': params.apiKey,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const data: Record<string, unknown> = {}
      if (params.company_website) data.company_website = params.company_website
      if (params.company_linkedin_url) data.company_linkedin_url = params.company_linkedin_url
      if (params.company_name) data.company_name = params.company_name
      if (params.company_id) data.company_id = params.company_id
      return { data }
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      throw new Error(await extractProspeoError(response))
    }
    const data = await response.json()
    return {
      success: true,
      output: {
        free_enrichment: data.free_enrichment ?? false,
        company: data.company ?? null,
      },
    }
  },

  outputs: {
    free_enrichment: {
      type: 'boolean',
      description: 'True if this enrichment was free (already enriched in the past)',
    },
    company: {
      type: 'json',
      description:
        'The matched company object including name, website, domain, industry, employee_count, location, social URLs, funding, and technology',
      optional: true,
    },
  },
}
