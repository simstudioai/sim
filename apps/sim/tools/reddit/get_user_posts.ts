import { validateEnum, validatePathSegment } from '@/lib/core/security/input-validation'
import { POST_LISTING_OUTPUT_PROPERTIES, type RedditPost } from '@/tools/reddit/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

const ALLOWED_SORT_OPTIONS = ['hot', 'new', 'top', 'controversial'] as const

interface GetUserPostsParams {
  username: string
  sort?: 'hot' | 'new' | 'top' | 'controversial'
  time?: 'hour' | 'day' | 'week' | 'month' | 'year' | 'all'
  limit?: number
  after?: string
  before?: string
  count?: number
  show?: string
  sr_detail?: boolean
  accessToken: string
}

interface GetUserPostsResponse extends ToolResponse {
  output: {
    posts: RedditPost[]
    after: string | null
    before: string | null
  }
}

export const getUserPostsTool: ToolConfig<GetUserPostsParams, GetUserPostsResponse> = {
  id: 'reddit_get_user_posts',
  name: 'Get Reddit User Posts',
  description: 'Fetch submitted posts (t3) from a Reddit user profile',
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
    username: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Reddit username whose posts to fetch (e.g., "spez", "example_user")',
    },
    sort: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort method for posts: "hot", "new", "top", "controversial" (default: "new")',
    },
    time: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Time filter for "top"/"controversial" sorts: "hour", "day", "week", "month", "year", or "all" (default: "all")',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of posts to return (e.g., 25). Default: 25, max: 100',
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
    count: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'A count of items already seen in the listing (used for numbering)',
    },
    show: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Show items that would normally be filtered (e.g., "all")',
    },
    sr_detail: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Expand subreddit details in the response',
    },
  },

  request: {
    url: (params: GetUserPostsParams) => {
      const username = params.username.trim().replace(/^u\//, '')
      const validation = validatePathSegment(username, { paramName: 'username' })
      if (!validation.isValid) {
        throw new Error(validation.error)
      }

      const limit = Math.min(Math.max(1, params.limit ?? 25), 100)

      const urlParams = new URLSearchParams({
        limit: limit.toString(),
        raw_json: '1',
      })

      if (params.sort !== undefined && params.sort !== null) {
        const sortValidation = validateEnum(params.sort, ALLOWED_SORT_OPTIONS, 'sort')
        if (!sortValidation.isValid) {
          throw new Error(sortValidation.error)
        }
        urlParams.append('sort', params.sort)

        if (
          (params.sort === 'top' || params.sort === 'controversial') &&
          params.time !== undefined &&
          params.time !== null
        ) {
          urlParams.append('t', params.time)
        }
      }

      if (params.after !== undefined && params.after !== null && params.after !== '')
        urlParams.append('after', params.after)
      if (params.before !== undefined && params.before !== null && params.before !== '')
        urlParams.append('before', params.before)
      if (params.count !== undefined && params.count !== null)
        urlParams.append('count', params.count.toString())
      if (params.show !== undefined && params.show !== null && params.show !== '')
        urlParams.append('show', params.show)
      if (params.sr_detail !== undefined && params.sr_detail !== null)
        urlParams.append('sr_detail', params.sr_detail.toString())

      return `https://oauth.reddit.com/user/${username}/submitted?${urlParams.toString()}`
    },
    method: 'GET',
    headers: (params: GetUserPostsParams) => {
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
          after: null,
          before: null,
        },
      }
    }

    const posts: RedditPost[] =
      data.data?.children?.map((child: any) => {
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
      }) || []

    return {
      success: true,
      output: {
        posts,
        after: data.data?.after ?? null,
        before: data.data?.before ?? null,
      },
    }
  },

  outputs: {
    posts: {
      type: 'array',
      description: 'Array of submitted posts with title, author, URL, score, and metadata',
      items: {
        type: 'object',
        properties: POST_LISTING_OUTPUT_PROPERTIES,
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
