import {
  COMMON_PARAMS,
  compactBody,
  glasserHeaders,
  pollRun,
  RUN_OUTPUTS,
  solutionUrl,
  transformRun,
} from '@/tools/glasser/run'
import type { GlasserResponse, GlasserWebResearchParams } from '@/tools/glasser/types'
import type { ToolConfig } from '@/tools/types'

export const webResearchTool: ToolConfig<GlasserWebResearchParams, GlasserResponse> = {
  id: 'glasser_web_research',
  name: 'Glasser Web Research',
  description:
    "Search the web, news, places, scholar, shopping, images or videos, read a page's content, find similar pages, or get an answer with sources. Glasser routes the call to Serper, SerpApi, Exa or DataForSEO.",
  version: '1.0.0',

  params: {
    action: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'search (default), news, places, scholar, shopping, images, videos and answer take query; scrape and similar take url.',
    },
    query: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Search phrase or question (query actions)',
    },
    url: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'A full http(s) URL to read or to find pages similar to (scrape, similar)',
    },
    country: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Country for search-type actions, as a two-letter ISO code or a name. Default us. Not for scrape or similar.',
    },
    language: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Language for search-type actions, two letters such as en, de',
    },
    limit: COMMON_PARAMS.limit,
    provider: {
      ...COMMON_PARAMS.provider,
      description: `${COMMON_PARAMS.provider.description} One of auto, serper, serpapi, exa, dataforseo.`,
    },
    task_id: COMMON_PARAMS.task_id,
    apiKey: COMMON_PARAMS.apiKey,
  },

  request: {
    /** Only `answer` hands the query to a model (Exa's answer endpoint); every other action is a plain search or fetch. */
    modelInput: {
      mode: 'project',
      select: (params) => (params.action === 'answer' ? { query: params.query } : {}),
    },
    url: solutionUrl('web_research'),
    method: 'POST',
    headers: (params) => glasserHeaders(params.apiKey),
    body: (params) =>
      compactBody({
        action: params.action,
        provider: params.provider,
        query: params.query,
        url: params.url,
        country: params.country,
        language: params.language,
        limit: params.limit,
        task_id: params.task_id,
      }),
  },

  transformResponse: transformRun,
  postProcess: async (result, params) => pollRun(result, params),

  outputs: RUN_OUTPUTS,
}
