import {
  COMMON_PARAMS,
  compactBody,
  glasserHeaders,
  pollRun,
  RUN_OUTPUTS,
  solutionUrl,
  transformRun,
} from '@/tools/glasser/run'
import type { GlasserCompanyIntelligenceParams, GlasserResponse } from '@/tools/glasser/types'
import type { ToolConfig } from '@/tools/types'

export const companyIntelligenceTool: ToolConfig<
  GlasserCompanyIntelligenceParams,
  GlasserResponse
> = {
  id: 'glasser_company_intelligence',
  name: 'Glasser Company Intelligence',
  description:
    'From a domain, get the company profile and firmographics, technology stack, website traffic, similar companies, funding rounds or news. Glasser routes the call to Apollo, People Data Labs, Hunter, Prospeo, PredictLeads, LeadMagic, BuiltWith, DataForSEO, Ahrefs, Apify, Exa or Serper.',
  version: '1.0.0',

  params: {
    domain: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Company website domain such as stripe.com. A full URL is reduced to its host.',
    },
    action: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'enrich (default): profile and firmographics. tech_stack, traffic, competitors (businesses similar to the company), funding, news.',
    },
    country: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Country as a two-letter ISO code or a name, e.g. us, gb, Germany. Default us. Applies to traffic and news.',
    },
    query: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'For news via Serper only: the company name to search Google News by, instead of the domain',
    },
    limit: COMMON_PARAMS.limit,
    provider: {
      ...COMMON_PARAMS.provider,
      description: `${COMMON_PARAMS.provider.description} One of auto, apollo, pdl, hunter, prospeo, predictleads, leadmagic, builtwith, dataforseo, ahrefs, apify, exa, serper.`,
    },
    task_id: COMMON_PARAMS.task_id,
    apiKey: COMMON_PARAMS.apiKey,
  },

  request: {
    url: solutionUrl('company_intelligence'),
    method: 'POST',
    headers: (params) => glasserHeaders(params.apiKey),
    body: (params) =>
      compactBody({
        action: params.action,
        provider: params.provider,
        domain: params.domain,
        country: params.country,
        query: params.query,
        limit: params.limit,
        task_id: params.task_id,
      }),
  },

  transformResponse: transformRun,
  postProcess: async (result, params) => pollRun(result, params),

  outputs: RUN_OUTPUTS,
}
