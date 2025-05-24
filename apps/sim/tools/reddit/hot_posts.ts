import type { ToolConfig } from '../types'
import type { RedditHotPostsResponse, RedditPost } from './types'

interface HotPostsParams {
  subreddit: string
  limit?: number
}

export const hotPostsTool: ToolConfig<HotPostsParams, RedditHotPostsResponse> = {
  id: 'reddit_hot_posts',
  name: 'Reddit Hot Posts',
  description: 'Fetch the most popular (hot) posts from a specified subreddit.',
  version: '1.0.0',

  params: {
    subreddit: {
      type: 'string',
      required: true,
      description: 'The name of the subreddit to fetch posts from (without the r/ prefix)',
    },
    limit: {
      type: 'number',
      required: false,
      description: 'Maximum number of posts to return (default: 10, max: 100)',
    },
  },

  request: {
    url: (params) => {
      // Sanitize inputs and enforce limits
      const subreddit = params.subreddit.trim().replace(/^r\//, '')
      const limit = Math.min(Math.max(1, params.limit || 10), 100)

      return `https://www.reddit.com/r/${subreddit}/hot.json?limit=${limit}&raw_json=1`
    },
    method: 'GET',
    headers: () => ({
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36',
      Accept: 'application/json',
    }),
  },

  transformResponse: async (response: Response, requestParams?: HotPostsParams) => {
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

      // Process the posts data with proper error handling
      const posts: RedditPost[] = data.data.children.map((child: any) => {
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
          selftext: post.selftext || '',
          thumbnail:
            post.thumbnail !== 'self' && post.thumbnail !== 'default' ? post.thumbnail : undefined,
          is_self: !!post.is_self,
          subreddit: post.subreddit || requestParams?.subreddit || '',
          subreddit_name_prefixed: post.subreddit_name_prefixed || '',
        }
      })

      // Extract the subreddit name from the response data with fallback
      const subreddit =
        data.data?.children?.[0]?.data?.subreddit ||
        (posts.length > 0 ? posts[0].subreddit : requestParams?.subreddit || '')

      return {
        success: true,
        output: {
          subreddit,
          posts,
        },
      }
    } catch (error: any) {
      const errorMessage = error.message || 'Unknown error'
      return {
        success: false,
        output: {
          subreddit: requestParams?.subreddit || '',
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
