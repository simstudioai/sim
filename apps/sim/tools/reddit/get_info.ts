import {
  COMMENT_LISTING_OUTPUT_PROPERTIES,
  POST_LISTING_OUTPUT_PROPERTIES,
  type RedditComment,
  type RedditPost,
} from '@/tools/reddit/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

interface RedditInfoSubreddit {
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

interface RedditGetInfoParams {
  id: string
  accessToken?: string
}

interface RedditGetInfoResponse extends ToolResponse {
  output: {
    posts: RedditPost[]
    comments: RedditComment[]
    subreddits: RedditInfoSubreddit[]
  }
}

export const getInfoTool: ToolConfig<RedditGetInfoParams, RedditGetInfoResponse> = {
  id: 'reddit_get_info',
  name: 'Get Reddit Info',
  description:
    'Fetch information about one or more Reddit things (posts, comments, or subreddits) by their fullnames',
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
    id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Comma-separated list of thing fullnames to look up (e.g., "t3_abc123,t1_xyz789,t5_2qh33"). Prefixes: t1_ = comment, t3_ = post, t5_ = subreddit',
    },
  },

  request: {
    url: (params: RedditGetInfoParams) => {
      const id = (params.id ?? '').trim()
      if (!id) {
        throw new Error('At least one thing fullname is required for Reddit API')
      }

      const urlParams = new URLSearchParams({
        id,
        raw_json: '1',
      })

      return `https://oauth.reddit.com/api/info?${urlParams.toString()}`
    },
    method: 'GET',
    headers: (params: RedditGetInfoParams) => {
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
          posts: [],
          comments: [],
          subreddits: [],
        },
      }
    }

    const children = data.data?.children ?? []

    const posts: RedditPost[] = children
      .filter((child: any) => child.kind === 't3')
      .map((child: any) => {
        const post = child.data || {}
        return {
          id: post.id ?? '',
          name: post.name ?? '',
          title: post.title ?? '',
          author: post.author || '[deleted]',
          url: post.url ?? '',
          permalink: post.permalink ? `https://www.reddit.com${post.permalink}` : '',
          created_utc: post.created_utc ?? 0,
          score: post.score ?? 0,
          num_comments: post.num_comments ?? 0,
          is_self: !!post.is_self,
          selftext: post.selftext ?? '',
          thumbnail: post.thumbnail ?? '',
          subreddit: post.subreddit ?? '',
        }
      })

    const comments: RedditComment[] = children
      .filter((child: any) => child.kind === 't1')
      .map((child: any) => {
        const comment = child.data || {}
        return {
          id: comment.id ?? '',
          name: comment.name ?? '',
          author: comment.author || '[deleted]',
          body: comment.body ?? '',
          created_utc: comment.created_utc ?? 0,
          score: comment.score ?? 0,
          permalink: comment.permalink ? `https://www.reddit.com${comment.permalink}` : '',
          replies: [],
        }
      })

    const subreddits: RedditInfoSubreddit[] = children
      .filter((child: any) => child.kind === 't5')
      .map((child: any) => {
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
      })

    return {
      success: true,
      output: {
        posts,
        comments,
        subreddits,
      },
    }
  },

  outputs: {
    posts: {
      type: 'array',
      description: 'Posts (t3) matched by the requested fullnames',
      items: {
        type: 'object',
        properties: POST_LISTING_OUTPUT_PROPERTIES,
      },
    },
    comments: {
      type: 'array',
      description: 'Comments (t1) matched by the requested fullnames',
      items: {
        type: 'object',
        properties: COMMENT_LISTING_OUTPUT_PROPERTIES,
      },
    },
    subreddits: {
      type: 'array',
      description: 'Subreddits (t5) matched by the requested fullnames',
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
  },
}
