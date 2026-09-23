import {
  COMMON_PARAMS,
  compactBody,
  glasserHeaders,
  pollRun,
  RUN_OUTPUTS,
  solutionUrl,
  transformRun,
} from '@/tools/glasser/run'
import type { GlasserResponse, GlasserSocialResearchParams } from '@/tools/glasser/types'
import type { ToolConfig } from '@/tools/types'

export const socialResearchTool: ToolConfig<GlasserSocialResearchParams, GlasserResponse> = {
  id: 'glasser_social_research',
  name: 'Glasser Social Media Search',
  description:
    "Search posts, read a profile or channel, read an account's recent posts, fetch one post, or find an account's other profiles on Reddit, X, YouTube, TikTok, Instagram and LinkedIn. Read-only. Glasser routes the call to ScrapeCreators, Apify, TikHub or People Data Labs.",
  version: '1.0.0',

  params: {
    platform: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'One of reddit, x, youtube, tiktok, instagram, linkedin',
    },
    mode: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        "search (default): posts matching query. profile: the account itself from handle (reddit: the subreddit; linkedin: url of a person or company page). feed: the account's recent posts from handle (linkedin: url of a company page). post: one post from url. find: an account's other social profiles from handle (linkedin: url of a person; reddit: subreddits matching query).",
    },
    query: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Search phrase (search; reddit find)',
    },
    handle: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'A username without @, or a subreddit name without r/ (profile, feed, find)',
    },
    url: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'A full http(s) URL of a post, or of a LinkedIn profile or company page',
    },
    provider: {
      ...COMMON_PARAMS.provider,
      description: `${COMMON_PARAMS.provider.description} One of auto, scrapecreators, apify, tikhub, pdl.`,
    },
    task_id: COMMON_PARAMS.task_id,
    apiKey: COMMON_PARAMS.apiKey,
  },

  request: {
    url: solutionUrl('social_research'),
    method: 'POST',
    headers: (params) => glasserHeaders(params.apiKey),
    body: (params) =>
      compactBody({
        platform: params.platform,
        mode: params.mode,
        provider: params.provider,
        query: params.query,
        handle: params.handle,
        url: params.url,
        task_id: params.task_id,
      }),
  },

  transformResponse: transformRun,
  postProcess: async (result, params) => pollRun(result, params),

  outputs: RUN_OUTPUTS,
}
