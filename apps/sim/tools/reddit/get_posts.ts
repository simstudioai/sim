import type { ToolConfig } from '../types'
import type { RedditPostsParams, RedditPostsResponse } from './types'

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
    try {
      // Check if response is OK
      if (!response.ok) {
        // Get response text for better error details
        const errorText = await response.text()
        console.error('Reddit API Error:', {
          status: response.status,
          statusText: response.statusText,
          body: errorText,
          url: response.url,
        })

        if (response.status === 403 || response.status === 429) {
          throw new Error('Reddit API access blocked or rate limited. Please try again later.')
        }
        throw new Error(
          `Reddit API returned ${response.status}: ${response.statusText}. Body: ${errorText}`
        )
      }

      // Attempt to parse JSON
      let data
      try {
        data = await response.json()
      } catch (error) {
        const responseText = await response.text()
        console.error('Failed to parse Reddit API response as JSON:', {
          error: error instanceof Error ? error.message : String(error),
          responseText,
          contentType: response.headers.get('content-type'),
        })
        throw new Error(
          `Failed to parse Reddit API response: Response was not valid JSON. Content: ${responseText}`
        )
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
