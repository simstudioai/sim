import fetch from 'node-fetch'
import { ToolConfig } from '../types'
import { RedditCommentsParams, RedditCommentsResponse } from './types'

export const getCommentsTool: ToolConfig<RedditCommentsParams, RedditCommentsResponse> = {
  id: 'reddit_get_comments',
  name: 'Get Reddit Comments',
  description: 'Fetch comments from a specific Reddit post',
  version: '1.0.0',

  params: {
    postId: {
      type: 'string',
      required: true,
      description: 'The ID of the Reddit post to fetch comments from',
    },
    subreddit: {
      type: 'string',
      required: true,
      description: 'The subreddit where the post is located (without the r/ prefix)',
    },
    sort: {
      type: 'string',
      required: false,
      description:
        'Sort method for comments: "confidence", "top", "new", "controversial", "old", "random", "qa" (default: "confidence")',
    },
    limit: {
      type: 'number',
      required: false,
      description: 'Maximum number of comments to return (default: 50, max: 100)',
    },
  },

  request: {
    url: (params: RedditCommentsParams) => {
      // Sanitize inputs
      const subreddit = params.subreddit.trim().replace(/^r\//, '')
      const sort = params.sort || 'confidence'
      const limit = Math.min(Math.max(1, params.limit || 50), 100)

      // Build URL
      return `https://www.reddit.com/r/${subreddit}/comments/${params.postId}.json?sort=${sort}&limit=${limit}`
    },
    method: 'GET',
    headers: () => ({
      'User-Agent': 'Sim Studio Reddit Tool/1.0',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

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
          const replies =
            commentData.replies && commentData.replies.data && commentData.replies.data.children
              ? processComments(commentData.replies.data.children)
              : []

          return {
            id: commentData.id,
            author: commentData.author,
            body: commentData.body,
            created_utc: commentData.created_utc,
            score: commentData.score,
            permalink: `https://www.reddit.com${commentData.permalink}`,
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
          id: postData.id,
          title: postData.title,
          author: postData.author,
          selftext: postData.selftext,
          created_utc: postData.created_utc,
          score: postData.score,
          permalink: `https://www.reddit.com${postData.permalink}`,
        },
        comments: comments,
      },
    }
  },

  transformError: (error) => {
    return `Error fetching Reddit comments: ${error.message}`
  },
}
