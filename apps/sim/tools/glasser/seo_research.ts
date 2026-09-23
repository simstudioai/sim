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
import type { GlasserResponse, GlasserSeoResearchParams } from '@/tools/glasser/types'
import type { ToolConfig } from '@/tools/types'

export const seoResearchTool: ToolConfig<GlasserSeoResearchParams, GlasserResponse> = {
  id: 'glasser_seo_research',
  name: 'Glasser Keywords and SEO',
  description:
    "Keyword volume and difficulty, keyword ideas, Google results for a keyword, a domain's organic overview, ranking keywords and organic competitors, backlinks, referring domains and domain rating. Glasser routes the call to Semrush, Serpstat, DataForSEO, Ahrefs or Serper.",
  version: '1.0.0',

  params: {
    action: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'keyword_overview (default) takes keywords, several at once; keyword_ideas and serp take exactly one keyword. domain_overview, ranked_keywords, organic_competitors, backlinks_overview, backlinks, referring_domains and domain_rating take domain.',
    },
    keywords: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Keywords, comma-separated, up to 20 (keyword actions)',
    },
    domain: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Website domain such as stripe.com (domain actions). A full URL is reduced to its host.',
    },
    country: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Country as a two-letter ISO code or a name, e.g. us, gb, Germany. Default us.',
    },
    limit: COMMON_PARAMS.limit,
    provider: {
      ...COMMON_PARAMS.provider,
      description: `${COMMON_PARAMS.provider.description} One of auto, semrush, serpstat, dataforseo, ahrefs, serper.`,
    },
    task_id: COMMON_PARAMS.task_id,
    apiKey: COMMON_PARAMS.apiKey,
  },

  request: {
    url: solutionUrl('seo_research'),
    method: 'POST',
    headers: (params) => glasserHeaders(params.apiKey),
    body: (params) =>
      compactBody({
        action: params.action,
        provider: params.provider,
        keywords: toList(params.keywords),
        domain: params.domain,
        country: params.country,
        limit: params.limit,
        task_id: params.task_id,
      }),
  },

  transformResponse: transformRun,
  postProcess: async (result, params) => pollRun(result, params),

  outputs: RUN_OUTPUTS,
}
