import { ToolConfig } from '../types'
import { RedditHotPostsResponse, RedditPost } from './types'

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
    url: (params) =>
      `https://www.reddit.com/r/${params.subreddit}/hot.json?limit=${params.limit || 10}`,
    method: 'GET',
    headers: () => ({
      'User-Agent': 'SimStudio/1.0.0',
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.message || 'Failed to fetch Reddit posts')
    }

    if (data.error) {
      throw new Error(data.message || 'Reddit API error')
    }

    const posts: RedditPost[] = data.data.children.map((child: any) => {
      const post = child.data
      return {
        id: post.id,
        title: post.title,
        author: post.author,
        url: post.url,
        permalink: `https://www.reddit.com${post.permalink}`,
        created_utc: post.created_utc,
        score: post.score,
        num_comments: post.num_comments,
        selftext: post.selftext,
        thumbnail:
          post.thumbnail !== 'self' && post.thumbnail !== 'default' ? post.thumbnail : undefined,
        is_self: post.is_self,
        subreddit: post.subreddit,
        subreddit_name_prefixed: post.subreddit_name_prefixed,
      }
    })

    // Extract the subreddit name from the response data
    const subreddit =
      data.data?.children?.[0]?.data?.subreddit || (posts.length > 0 ? posts[0].subreddit : '')

    return {
      success: true,
      output: {
        subreddit,
        posts,
      },
    }
  },

  transformError: (error) => {
    return error instanceof Error ? error.message : 'An error occurred while fetching Reddit posts'
  },
}
