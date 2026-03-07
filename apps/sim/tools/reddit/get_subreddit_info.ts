import type {
  RedditGetSubredditInfoParams,
  RedditSubredditInfoResponse,
} from '@/tools/reddit/types'
import { normalizeSubreddit } from '@/tools/reddit/utils'
import type { ToolConfig } from '@/tools/types'

export const getSubredditInfoTool: ToolConfig<
  RedditGetSubredditInfoParams,
  RedditSubredditInfoResponse
> = {
  id: 'reddit_get_subreddit_info',
  name: 'Get Subreddit Info',
  description: 'Get metadata and information about a subreddit',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'reddit',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Access token for Reddit API',
    },
    subreddit: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The subreddit to get info about (e.g., "technology", "programming", "news")',
    },
  },

  request: {
    url: (params: RedditGetSubredditInfoParams) => {
      const subreddit = normalizeSubreddit(params.subreddit)
      return `https://oauth.reddit.com/r/${subreddit}/about?raw_json=1`
    },
    method: 'GET',
    headers: (params: RedditGetSubredditInfoParams) => {
      if (!params.accessToken) {
        throw new Error('Access token is required for Reddit API')
      }

      return {
        Authorization: `Bearer ${params.accessToken}`,
        'User-Agent': 'sim-studio/1.0 (https://github.com/simstudioai/sim)',
        Accept: 'application/json',
      }
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      return {
        success: false,
        output: {
          id: '',
          name: '',
          display_name: '',
          title: '',
          description: '',
          public_description: '',
          subscribers: 0,
          accounts_active: 0,
          created_utc: 0,
          over18: false,
          lang: '',
          subreddit_type: '',
          url: '',
          icon_img: null,
          banner_img: null,
        },
      }
    }

    const sub = data.data || data

    return {
      success: true,
      output: {
        id: sub.id ?? '',
        name: sub.name ?? '',
        display_name: sub.display_name ?? '',
        title: sub.title ?? '',
        description: sub.description ?? '',
        public_description: sub.public_description ?? '',
        subscribers: sub.subscribers ?? 0,
        accounts_active: sub.accounts_active ?? 0,
        created_utc: sub.created_utc ?? 0,
        over18: sub.over18 ?? false,
        lang: sub.lang ?? '',
        subreddit_type: sub.subreddit_type ?? '',
        url: sub.url ?? '',
        icon_img: sub.icon_img ?? null,
        banner_img: sub.banner_img ?? null,
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'Subreddit ID' },
    name: { type: 'string', description: 'Subreddit fullname (t5_xxxxx)' },
    display_name: { type: 'string', description: 'Subreddit name without prefix' },
    title: { type: 'string', description: 'Subreddit title' },
    description: { type: 'string', description: 'Full subreddit description (markdown)' },
    public_description: { type: 'string', description: 'Short public description' },
    subscribers: { type: 'number', description: 'Number of subscribers' },
    accounts_active: { type: 'number', description: 'Number of currently active users' },
    created_utc: { type: 'number', description: 'Creation time in UTC epoch seconds' },
    over18: { type: 'boolean', description: 'Whether the subreddit is NSFW' },
    lang: { type: 'string', description: 'Primary language of the subreddit' },
    subreddit_type: {
      type: 'string',
      description: 'Subreddit type: public, private, restricted, etc.',
    },
    url: { type: 'string', description: 'Subreddit URL path (e.g., /r/technology/)' },
    icon_img: { type: 'string', description: 'Subreddit icon URL', optional: true },
    banner_img: { type: 'string', description: 'Subreddit banner URL', optional: true },
  },
}
