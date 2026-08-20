import type { ToolConfig } from '../types'
import type { RedditPostsParams, RedditPostsResponse } from './types'

export const getPostsTool: ToolConfig<RedditPostsParams, RedditPostsResponse> = {
  id: 'reddit_get_posts',
  name: 'Get Reddit Posts',
  description: 'Fetch posts from a subreddit with different sorting options',
  version: '1.0.0',

  params: {
    subreddit: {
      type: 'string',
      required: true,
      description: 'The name of the subreddit to fetch posts from (without the r/ prefix)',
    },
    sort: {
      type: 'string',
      required: false,
      description: 'Sort method for posts: "hot", "new", "top", or "rising" (default: "hot")',
    },
    limit: {
      type: 'number',
      required: false,
      description: 'Maximum number of posts to return (default: 10, max: 100)',
    },
    time: {
      type: 'string',
      required: false,
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

      // Build URL with appropriate parameters
      let url = `https://www.reddit.com/r/${subreddit}/${sort}.json?limit=${limit}&raw_json=1`

      // Add time parameter only for 'top' sorting
      if (sort === 'top' && params.time) {
        url += `&t=${params.time}`
      }

      return url
    },
    method: 'GET',
    headers: () => ({
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36',
      Accept: 'application/json',
    }),
  },

  transformResponse: async (response: Response, requestParams?: RedditPostsParams) => {
    try {
      // Check if response is OK
      if (!response.ok) {
        if (response.status === 403 || response.status === 429) {
          throw new Error('Reddit API access blocked or rate limited. Please try again later.')
        }
        throw new Error(`Reddit API returned ${response.status}: ${response.statusText}`)
      }

      // Attempt to parse JSON
      let data
      try {
        data = await response.json()
      } catch (_error) {
        throw new Error('Failed to parse Reddit API response: Response was not valid JSON')
      }

      // Check if response contains error
      if (data.error || !data.data) {
        throw new Error(data.message || 'Invalid response from Reddit API')
      }

      // Extract subreddit name from response (with fallback)
      const subredditName =
        data.data?.children[0]?.data?.subreddit || requestParams?.subreddit || 'unknown'

      // Transform posts data with proper error handling
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
    } catch (error: any) {
      const errorMessage = error.message || 'Unknown error'
      return {
        success: false,
        output: {
          subreddit: requestParams?.subreddit || 'unknown',
          posts: [],
        },
        error: errorMessage,
      }
    }
  },

  transformError: (error): string => {
    // Create detailed error message
    let errorMessage = error.message || 'Unknown error'

    if (errorMessage.includes('blocked') || errorMessage.includes('rate limited')) {
      errorMessage = `Reddit access is currently unavailable: ${errorMessage}. Consider reducing request frequency or using the official Reddit API with authentication.`
    }

    if (errorMessage.includes('not valid JSON')) {
      errorMessage =
        'Unable to process Reddit response: Received non-JSON response, which typically happens when Reddit blocks automated access.'
    }

    return `Error fetching Reddit posts: ${errorMessage}`
  },
}
