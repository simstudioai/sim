import type { ToolConfig } from '../types'
import type { RedditCommentsParams, RedditCommentsResponse } from './types'

export const getCommentsTool: ToolConfig<RedditCommentsParams, RedditCommentsResponse> = {
  id: 'reddit_get_comments',
  name: 'Get Reddit Comments',
  description: 'Fetch comments from a specific Reddit post',
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
    postId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'The ID of the Reddit post to fetch comments from',
    },
    subreddit: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The subreddit where the post is located (without the r/ prefix)',
    },
    sort: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Sort method for comments: "confidence", "top", "new", "controversial", "old", "random", "qa" (default: "confidence")',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Maximum number of comments to return (default: 50, max: 100)',
    },
  },

  request: {
    url: (params: RedditCommentsParams) => {
      // Sanitize inputs
      const subreddit = params.subreddit.trim().replace(/^r\//, '')
      const sort = params.sort || 'confidence'
      const limit = Math.min(Math.max(1, params.limit || 50), 100)

      // Build URL using OAuth endpoint
      return `https://oauth.reddit.com/r/${subreddit}/comments/${params.postId}?sort=${sort}&limit=${limit}&raw_json=1`
    },
    method: 'GET',
    headers: (params: RedditCommentsParams) => {
      if (!params.accessToken?.trim()) {
        throw new Error('Access token is required for Reddit API')
      }

      return {
        Authorization: `Bearer ${params.accessToken}`,
        'User-Agent': 'sim-studio/1.0 (https://github.com/simstudioai/sim)',
        Accept: 'application/json',
      }
    },
  },

  transformResponse: async (response: Response, requestParams?: RedditCommentsParams) => {
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

      // Validate data structure
      if (!Array.isArray(data) || data.length < 2) {
        throw new Error('Invalid response format from Reddit API')
      }

      // Extract post data (first element in the array)
      const postData = data[0]?.data?.children[0]?.data || {}

      // Extract and transform comments (second element in the array)
      const commentsData = data[1]?.data?.children || []

      // Recursive function to process nested comments
      const processComments = (comments: any[]): any[] => {
        return comments
          .map((comment) => {
            const commentData = comment.data

            // Skip non-comment items like "more" items
            if (!commentData || comment.kind !== 't1') {
              return null
            }

            // Process nested replies if they exist
            const replies = commentData.replies?.data?.children
              ? processComments(commentData.replies.data.children)
              : []

            return {
              id: commentData.id || '',
              author: commentData.author || '[deleted]',
              body: commentData.body || '',
              created_utc: commentData.created_utc || 0,
              score: commentData.score || 0,
              permalink: commentData.permalink
                ? `https://www.reddit.com${commentData.permalink}`
                : '',
              replies: replies.filter(Boolean),
            }
          })
          .filter(Boolean)
      }

      const comments = processComments(commentsData)

      return {
        success: true,
        output: {
          post: {
            id: postData.id || '',
            title: postData.title || '',
            author: postData.author || '[deleted]',
            selftext: postData.selftext || '',
            created_utc: postData.created_utc || 0,
            score: postData.score || 0,
            permalink: postData.permalink ? `https://www.reddit.com${postData.permalink}` : '',
          },
          comments: comments,
        },
      }
    } catch (error: any) {
      const errorMessage = error.message || 'Unknown error'
      return {
        success: false,
        output: {
          post: {
            id: '',
            title: '',
            author: '',
            selftext: '',
            created_utc: 0,
            score: 0,
            permalink: '',
          },
          comments: [],
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

    return `Error fetching Reddit comments: ${errorMessage}`
  },
}
