import type { RedditCommentsParams, RedditCommentsResponse } from '@/tools/reddit/types'
import type { ToolConfig } from '@/tools/types'

export const getCommentsTool: ToolConfig<RedditCommentsParams, RedditCommentsResponse> = {
  id: 'reddit_get_comments',
  name: 'Get Reddit Comments',
  description: 'Fetch comments from a specific Reddit post',
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
    depth: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum depth of subtrees in the thread (controls nested comment levels)',
    },
    context: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of parent comments to include',
    },
    showedits: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Show edit information for comments',
    },
    showmore: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include "load more comments" elements in the response',
    },
    showtitle: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include submission title in the response',
    },
    threaded: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Return comments in threaded/nested format',
    },
    truncate: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Integer to truncate comment depth',
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
  },

  request: {
    url: (params: RedditCommentsParams) => {
      // Sanitize inputs
      const subreddit = params.subreddit.trim().replace(/^r\//, '')
      const sort = params.sort || 'confidence'
      const limit = Math.min(Math.max(1, params.limit || 50), 100)

      // Build URL with query parameters
      const urlParams = new URLSearchParams({
        sort: sort,
        limit: limit.toString(),
        raw_json: '1',
      })

      // Add comment-specific parameters if provided
      if (params.depth !== undefined) urlParams.append('depth', Number(params.depth).toString())
      if (params.context !== undefined)
        urlParams.append('context', Number(params.context).toString())
      if (params.showedits !== undefined) urlParams.append('showedits', params.showedits.toString())
      if (params.showmore !== undefined) urlParams.append('showmore', params.showmore.toString())
      if (params.showtitle !== undefined) urlParams.append('showtitle', params.showtitle.toString())
      if (params.threaded !== undefined) urlParams.append('threaded', params.threaded.toString())
      if (params.truncate !== undefined)
        urlParams.append('truncate', Number(params.truncate).toString())

      // Add pagination parameters if provided
      if (params.after) urlParams.append('after', params.after)
      if (params.before) urlParams.append('before', params.before)
      if (params.count !== undefined) urlParams.append('count', Number(params.count).toString())

      // Build URL using OAuth endpoint
      return `https://oauth.reddit.com/r/${subreddit}/comments/${params.postId}?${urlParams.toString()}`
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
  },

  outputs: {
    post: {
      type: 'object',
      description: 'Post information including ID, title, author, content, and metadata',
      properties: {
        id: { type: 'string', description: 'Post ID' },
        title: { type: 'string', description: 'Post title' },
        author: { type: 'string', description: 'Post author' },
        selftext: { type: 'string', description: 'Post text content' },
        score: { type: 'number', description: 'Post score' },
        created_utc: { type: 'number', description: 'Creation timestamp' },
        permalink: { type: 'string', description: 'Reddit permalink' },
      },
    },
    comments: {
      type: 'array',
      description: 'Nested comments with author, body, score, timestamps, and replies',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Comment ID' },
          author: { type: 'string', description: 'Comment author' },
          body: { type: 'string', description: 'Comment text' },
          score: { type: 'number', description: 'Comment score' },
          created_utc: { type: 'number', description: 'Creation timestamp' },
          permalink: { type: 'string', description: 'Comment permalink' },
          replies: {
            type: 'array',
            description: 'Nested reply comments',
            items: { type: 'object', description: 'Nested comment with same structure' },
          },
        },
      },
    },
  },
}
