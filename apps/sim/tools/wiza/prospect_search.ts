import type { ToolConfig } from '@/tools/types'
import { wizaHosting } from '@/tools/wiza/hosting'
import type { WizaProspectSearchParams, WizaProspectSearchResponse } from '@/tools/wiza/types'

export const wizaProspectSearchTool: ToolConfig<
  WizaProspectSearchParams,
  WizaProspectSearchResponse
> = {
  id: 'wiza_prospect_search',
  name: 'Wiza Prospect Search',
  description: "Search Wiza's database of prospects using person, company, and financial filters",
  version: '1.0.0',

  hosting: wizaHosting<WizaProspectSearchParams>(() => {
    // Prospect search returns profiles without contact data and consumes no credits;
    // Wiza charges only on reveal/enrichment.
    return 0
  }),

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Wiza API key',
    },
    size: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of sample profiles to return (0-30, default 0)',
    },
    filters: {
      type: 'object',
      required: false,
      visibility: 'user-or-llm',
      description: 'Full filters object (overrides individual filter params if provided)',
    },
    first_name: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'Exact first names to match (e.g., ["John", "Jane"])',
    },
    last_name: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'Exact last names to match',
    },
    job_title: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Job titles to include/exclude (e.g., [{"v":"CEO","s":"i"},{"v":"CTO","s":"e"}])',
    },
    job_title_level: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'Seniority levels (e.g., ["cxo", "director", "manager"])',
    },
    job_role: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'Job role categories (e.g., ["sales", "engineering", "marketing"])',
    },
    job_sub_role: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'Detailed role categories (e.g., ["software", "product"])',
    },
    location: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: "Person's location filters (city/state/country with include/exclude)",
    },
    skill: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'Professional skills (e.g., ["python", "marketing"])',
    },
    school: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'Educational institutions',
    },
    major: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'Field of study',
    },
    linkedin_slug: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'LinkedIn profile slugs',
    },
    job_company: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'Current company filters (include/exclude)',
    },
    past_company: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'Past company filters',
    },
    company_location: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'Company HQ location filters',
    },
    company_industry: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'Company industry filters (include/exclude)',
    },
    company_size: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'Company headcount brackets (e.g., ["1-10", "11-50", "51-200"])',
    },
    company_type: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'Company type (e.g., ["private", "public", "educational"])',
    },
  },

  request: {
    url: 'https://wiza.co/api/prospects/search',
    method: 'POST',
    headers: (params: WizaProspectSearchParams) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params: WizaProspectSearchParams) => {
      const body: Record<string, unknown> = {}

      if (typeof params.size === 'number') {
        body.size = Math.max(0, Math.min(params.size, 30))
      }

      if (
        params.filters &&
        typeof params.filters === 'object' &&
        !Array.isArray(params.filters) &&
        Object.keys(params.filters).length > 0
      ) {
        body.filters = params.filters
        return body
      }

      const filters: Record<string, unknown> = {}
      const arrayKeys: Array<keyof WizaProspectSearchParams> = [
        'first_name',
        'last_name',
        'job_title',
        'job_title_level',
        'job_role',
        'job_sub_role',
        'location',
        'skill',
        'school',
        'major',
        'linkedin_slug',
        'job_company',
        'past_company',
        'company_location',
        'company_industry',
        'company_size',
        'company_type',
      ]

      for (const key of arrayKeys) {
        const value = params[key]
        if (Array.isArray(value) && value.length > 0) {
          filters[key as string] = value
        }
      }

      if (Object.keys(filters).length > 0) {
        body.filters = filters
      }
      return body
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Wiza API error: ${response.status} - ${errorText}`)
    }

    const data = await response.json()
    const payload = data.data ?? {}
    const profiles = Array.isArray(payload.profiles) ? payload.profiles : []

    return {
      success: true,
      output: {
        total: payload.total ?? 0,
        profiles: profiles.map((p: Record<string, unknown>) => ({
          full_name: (p.full_name as string) ?? null,
          linkedin_url: (p.linkedin_url as string) ?? null,
          industry: (p.industry as string) ?? null,
          job_title: (p.job_title as string) ?? null,
          job_title_role: (p.job_title_role as string) ?? null,
          job_title_sub_role: (p.job_title_sub_role as string) ?? null,
          job_company_name: (p.job_company_name as string) ?? null,
          job_company_website: (p.job_company_website as string) ?? null,
          location_name: (p.location_name as string) ?? null,
        })),
      },
    }
  },

  outputs: {
    total: { type: 'number', description: 'Total number of matching prospects' },
    profiles: {
      type: 'array',
      description: 'Sample profiles matching the filter criteria',
      items: {
        type: 'object',
        properties: {
          full_name: { type: 'string' },
          linkedin_url: { type: 'string' },
          industry: { type: 'string' },
          job_title: { type: 'string' },
          job_title_role: { type: 'string' },
          job_title_sub_role: { type: 'string' },
          job_company_name: { type: 'string' },
          job_company_website: { type: 'string' },
          location_name: { type: 'string' },
        },
      },
    },
  },
}
