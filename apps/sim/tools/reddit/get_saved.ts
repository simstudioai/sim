import { validatePathSegment } from '@/lib/core/security/input-validation'
import {
  COMMENT_LISTING_OUTPUT_PROPERTIES,
  POST_LISTING_OUTPUT_PROPERTIES,
  type RedditComment,
  type RedditPost,
} from '@/tools/reddit/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

interface GetSavedParams {
  username: string
  limit?: number
  after?: string
  before?: string
  count?: number
  show?: string
  sr_detail?: boolean
  accessToken: string
}

interface GetSavedResponse extends ToolResponse {
  output: {
    posts: RedditPost[]
    comments: RedditComment[]
    after: string | null
    before: string | null
  }
}

export const getSavedTool: ToolConfig<GetSavedParams, GetSavedResponse> = {
  id: 'reddit_get_saved',
  name: 'Get Reddit Saved Items',
  description:
    'Fetch your own saved posts (t3) and comments (t1). You can only read your own saved items',
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
      description:
        'Your own Reddit username (saved items can only be read for the authenticated user)',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of items to return (e.g., 25). Default: 25, max: 100',
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
    url: (params: GetSavedParams) => {
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

      return `https://oauth.reddit.com/user/${username}/saved?${urlParams.toString()}`
    },
    method: 'GET',
    headers: (params: GetSavedParams) => {
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
          after: null,
          before: null,
        },
      }
    }

    const posts: RedditPost[] = []
    const comments: RedditComment[] = []

    const children = data.data?.children || []
    for (const child of children) {
      const item = child.data || {}
      if (child.kind === 't3') {
        posts.push({
          id: item.id ?? '',
          name: item.name ?? '',
          title: item.title ?? '',
          author: item.author || '[deleted]',
          url: item.url ?? '',
          permalink: item.permalink ? `https://www.reddit.com${item.permalink}` : '',
          created_utc: item.created_utc ?? 0,
          score: item.score ?? 0,
          num_comments: item.num_comments ?? 0,
          is_self: !!item.is_self,
          selftext: item.selftext ?? '',
          thumbnail: item.thumbnail ?? '',
          subreddit: item.subreddit ?? '',
        })
      } else if (child.kind === 't1') {
        comments.push({
          id: item.id ?? '',
          name: item.name ?? '',
          author: item.author || '[deleted]',
          body: item.body ?? '',
          score: item.score ?? 0,
          created_utc: item.created_utc ?? 0,
          permalink: item.permalink ? `https://www.reddit.com${item.permalink}` : '',
          replies: [],
        })
      }
    }

    return {
      success: true,
      output: {
        posts,
        comments,
        after: data.data?.after ?? null,
        before: data.data?.before ?? null,
      },
    }
  },

  outputs: {
    posts: {
      type: 'array',
      description: 'Array of saved posts (t3) with title, author, URL, score, and metadata',
      items: {
        type: 'object',
        properties: POST_LISTING_OUTPUT_PROPERTIES,
      },
    },
    comments: {
      type: 'array',
      description: 'Array of saved comments (t1) with author, body, score, and permalink',
      items: {
        type: 'object',
        properties: COMMENT_LISTING_OUTPUT_PROPERTIES,
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
