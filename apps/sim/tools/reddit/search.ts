import type { RedditPostsResponse, RedditSearchParams } from '@/tools/reddit/types'
import type { ToolConfig } from '@/tools/types'

export const searchTool: ToolConfig<RedditSearchParams, RedditPostsResponse> = {
  id: 'reddit_search',
  name: 'Search Reddit',
  description: 'Search for posts within a subreddit',
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
      description: 'The name of the subreddit to search in (without the r/ prefix)',
    },
    query: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Search query text',
    },
    sort: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Sort method for search results: "relevance", "hot", "top", "new", or "comments" (default: "relevance")',
    },
    time: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Time filter for search results: "hour", "day", "week", "month", "year", or "all" (default: "all")',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Maximum number of posts to return (default: 10, max: 100)',
    },
    restrict_sr: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Restrict search to the specified subreddit only (default: true)',
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
  },

  request: {
    url: (params: RedditSearchParams) => {
      // Sanitize inputs
      const subreddit = params.subreddit.trim().replace(/^r\//, '')
      const sort = params.sort || 'relevance'
      const limit = Math.min(Math.max(1, params.limit || 10), 100)
      const restrict_sr = params.restrict_sr !== false // Default to true

      // Build URL with appropriate parameters using OAuth endpoint
      const urlParams = new URLSearchParams({
        q: params.query,
        sort: sort,
        limit: limit.toString(),
        restrict_sr: restrict_sr.toString(),
        raw_json: '1',
      })

      // Add time filter if provided
      if (params.time) {
        urlParams.append('t', params.time)
      }

      // Add pagination parameters if provided
      if (params.after) urlParams.append('after', params.after)
      if (params.before) urlParams.append('before', params.before)
      if (params.count !== undefined) urlParams.append('count', Number(params.count).toString())
      if (params.show) urlParams.append('show', params.show)

      return `https://oauth.reddit.com/r/${subreddit}/search?${urlParams.toString()}`
    },
    method: 'GET',
    headers: (params: RedditSearchParams) => {
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

  transformResponse: async (response: Response, requestParams?: RedditSearchParams) => {
    const data = await response.json()

    // Extract subreddit name from response (with fallback)
    const subredditName =
      data.data?.children[0]?.data?.subreddit || requestParams?.subreddit || 'unknown'

    // Transform posts data
    const posts =
      data.data?.children?.map((child: any) => {
        const post = child.data || {}
        return {
          id: post.id || '',
          title: post.title || '',
          author: post.author || '[deleted]',
          url: post.url || '',
          permalink: post.permalink ? `https://www.reddit.com${post.permalink}` : '',
          created_utc: post.created_utc || 0,
          score: post.score || 0,
          num_comments: post.num_comments || 0,
          is_self: !!post.is_self,
          selftext: post.selftext || '',
          thumbnail: post.thumbnail || '',
          subreddit: post.subreddit || subredditName,
        }
      }) || []

    return {
      success: true,
      output: {
        subreddit: subredditName,
        posts,
      },
    }
  },

  outputs: {
    subreddit: {
      type: 'string',
      description: 'Name of the subreddit where search was performed',
    },
    posts: {
      type: 'array',
      description:
        'Array of search result posts with title, author, URL, score, comments count, and metadata',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Post ID' },
          title: { type: 'string', description: 'Post title' },
          author: { type: 'string', description: 'Author username' },
          url: { type: 'string', description: 'Post URL' },
          permalink: { type: 'string', description: 'Reddit permalink' },
          score: { type: 'number', description: 'Post score (upvotes - downvotes)' },
          num_comments: { type: 'number', description: 'Number of comments' },
          created_utc: { type: 'number', description: 'Creation timestamp (UTC)' },
          is_self: { type: 'boolean', description: 'Whether this is a text post' },
          selftext: { type: 'string', description: 'Text content for self posts' },
          thumbnail: { type: 'string', description: 'Thumbnail URL' },
          subreddit: { type: 'string', description: 'Subreddit name' },
        },
      },
    },
  },
}
