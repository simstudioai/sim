import {
  COMMON_PARAMS,
  compactBody,
  glasserHeaders,
  pollRun,
  RUN_OUTPUTS,
  solutionUrl,
  toList,
  transformRun,
} from '@/tools/glasser/run'
import type { GlasserPeopleSearchParams, GlasserResponse } from '@/tools/glasser/types'
import type { ToolConfig } from '@/tools/types'

export const peopleSearchTool: ToolConfig<GlasserPeopleSearchParams, GlasserResponse> = {
  id: 'glasser_people_search',
  name: 'Glasser Find Prospects',
  description:
    'Find contacts by title, seniority, location or employer, enrich one person, or find a work email. Glasser routes the call to Apollo, People Data Labs, LeadMagic, ZoomInfo, Hunter or Prospeo and charges only what that provider costs.',
  version: '1.0.0',

  params: {
    action: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'search (default): people matching job_titles, seniorities, locations, company_domain or keywords, at least one. enrich: one person from linkedin_url, email, or full_name plus company_domain. find_email: the work email of full_name at company_domain.',
    },
    job_titles: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Job titles to match, comma-separated, up to 20 (e.g. "CTO, VP Engineering")',
    },
    seniorities: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Seniority levels, comma-separated, from owner, founder, c_suite, partner, vp, head, director, manager, senior, entry, intern',
    },
    locations: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Cities, states or countries, comma-separated, up to 20',
    },
    company_domain: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Employer website domain such as stripe.com. A full URL is reduced to its host.',
    },
    keywords: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Free-text keywords to match against profiles (search only)',
    },
    full_name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: "The person's full name (enrich, find_email)",
    },
    email: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'An email address to enrich from (enrich)',
    },
    linkedin_url: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'LinkedIn profile URL, linkedin.com/in/<slug>, not a company page (enrich)',
    },
    limit: COMMON_PARAMS.limit,
    provider: {
      ...COMMON_PARAMS.provider,
      description: `${COMMON_PARAMS.provider.description} One of auto, apollo, pdl, leadmagic, zoominfo, hunter, prospeo.`,
    },
    task_id: COMMON_PARAMS.task_id,
    apiKey: COMMON_PARAMS.apiKey,
  },

  request: {
    url: solutionUrl('people_search'),
    method: 'POST',
    headers: (params) => glasserHeaders(params.apiKey),
    body: (params) =>
      compactBody({
        action: params.action,
        provider: params.provider,
        job_titles: toList(params.job_titles),
        seniorities: toList(params.seniorities),
        locations: toList(params.locations),
        company_domain: params.company_domain,
        keywords: params.keywords,
        full_name: params.full_name,
        email: params.email,
        linkedin_url: params.linkedin_url,
        limit: params.limit,
        task_id: params.task_id,
      }),
  },

  transformResponse: transformRun,
  postProcess: async (result, params) => pollRun(result, params),

  outputs: RUN_OUTPUTS,
}
