import { validateEnum } from '@/lib/core/security/input-validation'
import type { ToolConfig, ToolResponse } from '@/tools/types'

const ALLOWED_SORT_OPTIONS = ['relevance', 'activity'] as const

interface RedditSubredditSummary {
  id: string
  name: string
  display_name: string
  title: string
  public_description: string
  subscribers: number
  over18: boolean
  url: string
  subreddit_type: string
  icon_img: string | null
  created_utc: number
  accounts_active: number
}

interface RedditSearchSubredditsParams {
  q: string
  limit?: number
  after?: string
  before?: string
  sort?: 'relevance' | 'activity'
  show_users?: boolean
  sr_detail?: boolean
  accessToken?: string
}

interface RedditSearchSubredditsResponse extends ToolResponse {
  output: {
    subreddits: RedditSubredditSummary[]
    after: string | null
    before: string | null
  }
}

export const searchSubredditsTool: ToolConfig<
  RedditSearchSubredditsParams,
  RedditSearchSubredditsResponse
> = {
  id: 'reddit_search_subreddits',
  name: 'Search Subreddits',
  description: 'Search for subreddits by name and description',
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
    q: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Search query to match against subreddit names and descriptions',
    },
    sort: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort order for results: "relevance" or "activity". Default: "relevance"',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of subreddits to return (e.g., 25). Default: 25, max: 100',
    },
    after: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Fullname of a thing to fetch items after (for pagination)',
    },
    before: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Fullname of a thing to fetch items before (for pagination)',
    },
    show_users: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to include matching user profiles in the results',
    },
    sr_detail: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Expand subreddit details in the response',
    },
  },

  request: {
    url: (params: RedditSearchSubredditsParams) => {
      const sort = params.sort || 'relevance'
      const sortValidation = validateEnum(sort, ALLOWED_SORT_OPTIONS, 'sort')
      if (!sortValidation.isValid) {
        throw new Error(sortValidation.error)
      }
      const limit = Math.min(Math.max(1, params.limit ?? 25), 100)

      const urlParams = new URLSearchParams({
        q: params.q ?? '',
        sort,
        limit: limit.toString(),
        raw_json: '1',
      })

      if (params.after !== undefined && params.after !== null && params.after !== '')
        urlParams.append('after', params.after)
      if (params.before !== undefined && params.before !== null && params.before !== '')
        urlParams.append('before', params.before)
      if (params.show_users !== undefined && params.show_users !== null)
        urlParams.append('show_users', params.show_users.toString())
      if (params.sr_detail !== undefined && params.sr_detail !== null)
        urlParams.append('sr_detail', params.sr_detail.toString())

      return `https://oauth.reddit.com/subreddits/search?${urlParams.toString()}`
    },
    method: 'GET',
    headers: (params: RedditSearchSubredditsParams) => {
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
          subreddits: [],
          after: null,
          before: null,
        },
      }
    }

    const subreddits: RedditSubredditSummary[] =
      data.data?.children?.map((child: any) => {
        const sub = child.data || {}
        return {
          id: sub.id ?? '',
          name: sub.name ?? '',
          display_name: sub.display_name ?? '',
          title: sub.title ?? '',
          public_description: sub.public_description ?? '',
          subscribers: sub.subscribers ?? 0,
          over18: sub.over18 ?? false,
          url: sub.url ?? '',
          subreddit_type: sub.subreddit_type ?? '',
          icon_img: sub.icon_img ?? null,
          created_utc: sub.created_utc ?? 0,
          accounts_active: sub.active_user_count ?? sub.accounts_active ?? 0,
        }
      }) || []

    return {
      success: true,
      output: {
        subreddits,
        after: data.data?.after ?? null,
        before: data.data?.before ?? null,
      },
    }
  },

  outputs: {
    subreddits: {
      type: 'array',
      description: 'Array of matching subreddits with name, description, and subscriber metadata',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Subreddit ID' },
          name: { type: 'string', description: 'Subreddit fullname (t5_xxxxx)' },
          display_name: { type: 'string', description: 'Subreddit name without prefix' },
          title: { type: 'string', description: 'Subreddit title' },
          public_description: { type: 'string', description: 'Short public description' },
          subscribers: { type: 'number', description: 'Number of subscribers' },
          over18: { type: 'boolean', description: 'Whether the subreddit is NSFW' },
          url: { type: 'string', description: 'Subreddit URL path (e.g., /r/technology/)' },
          subreddit_type: {
            type: 'string',
            description: 'Subreddit type: public, private, restricted, etc.',
          },
          icon_img: { type: 'string', description: 'Subreddit icon URL', optional: true },
          created_utc: { type: 'number', description: 'Creation time in UTC epoch seconds' },
          accounts_active: {
            type: 'number',
            description: 'Number of currently active users',
          },
        },
      },
    },
    after: {
      type: 'string',
      description: 'Fullname of the last item for forward pagination',
      optional: true,
    },
    before: {
      type: 'string',
      description: 'Fullname of the first item for backward pagination',
      optional: true,
    },
  },
}
