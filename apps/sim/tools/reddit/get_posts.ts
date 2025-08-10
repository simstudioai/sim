import type { RedditPostsParams, RedditPostsResponse } from '@/tools/reddit/types'
import type { ToolConfig } from '@/tools/types'

export const getPostsTool: ToolConfig<RedditPostsParams, RedditPostsResponse> = {
  id: 'reddit_get_posts',
  name: 'Get Reddit Posts',
  description: 'Fetch posts from a subreddit with different sorting options',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'reddit',
    additionalScopes: ['read'],
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
      description: 'The name of the subreddit to fetch posts from (without the r/ prefix)',
    },
    sort: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort method for posts: "hot", "new", "top", or "rising" (default: "hot")',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Maximum number of posts to return (default: 10, max: 100)',
    },
    time: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Time filter for "top" sorted posts: "day", "week", "month", "year", or "all" (default: "day")',
    },
  },

  request: {
    url: (params: RedditPostsParams) => {
      // Sanitize inputs
      const subreddit = params.subreddit.trim().replace(/^r\//, '')
      const sort = params.sort || 'hot'
      const limit = Math.min(Math.max(1, params.limit || 10), 100)

      // Build URL with appropriate parameters using OAuth endpoint
      let url = `https://oauth.reddit.com/r/${subreddit}/${sort}?limit=${limit}&raw_json=1`

      // Add time parameter only for 'top' sorting
      if (sort === 'top' && params.time) {
        url += `&t=${params.time}`
      }

      return url
    },
    method: 'GET',
    headers: (params: RedditPostsParams) => {
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

  transformResponse: async (response: Response, requestParams?: RedditPostsParams) => {
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
      description: 'Name of the subreddit where posts were fetched from',
    },
    posts: {
      type: 'array',
      description: 'Array of posts with title, author, URL, score, comments count, and metadata',
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
