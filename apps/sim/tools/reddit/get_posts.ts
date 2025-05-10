import fetch from 'node-fetch'
import { ToolConfig } from '../types'
import { RedditPostsParams, RedditPostsResponse } from './types'

export const getPostsTool: ToolConfig<RedditPostsParams, RedditPostsResponse> = {
  id: 'reddit_get_posts',
  name: 'Get Reddit Posts',
  description: 'Fetch posts from a subreddit with different sorting options',
  version: '1.0.0',
  
  params: {
    subreddit: {
      type: 'string',
      required: true,
      description: 'The name of the subreddit to fetch posts from (without the r/ prefix)'
    },
    sort: {
      type: 'string',
      required: false,
      description: 'Sort method for posts: "hot", "new", "top", or "rising" (default: "hot")'
    },
    limit: {
      type: 'number',
      required: false,
      description: 'Maximum number of posts to return (default: 10, max: 100)'
    },
    time: {
      type: 'string',
      required: false,
      description: 'Time filter for "top" sorted posts: "day", "week", "month", "year", or "all" (default: "day")'
    }
  },
  
  request: {
    url: (params: RedditPostsParams) => {
      // Sanitize inputs
      const subreddit = params.subreddit.trim().replace(/^r\//, '')
      const sort = params.sort || 'hot'
      const limit = Math.min(Math.max(1, params.limit || 10), 100)
      
      // Build URL with appropriate parameters
      let url = `https://www.reddit.com/r/${subreddit}/${sort}.json?limit=${limit}`
      
      // Add time parameter only for 'top' sorting
      if (sort === 'top' && params.time) {
        url += `&t=${params.time}`
      }
      
      return url
    },
    method: 'GET',
    headers: () => ({
      'User-Agent': 'Sim Studio Reddit Tool/1.0'
    })
  },
  
  transformResponse: async (response: Response) => {
    const data = await response.json()
    
    // Extract subreddit name from response
    const subredditName = data.data?.children[0]?.data?.subreddit || 'unknown'
    
    // Transform posts data
    const posts = data.data?.children.map((child: any) => {
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
        is_self: post.is_self,
        selftext: post.selftext,
        thumbnail: post.thumbnail,
        subreddit: post.subreddit
      }
    }) || []
    
    return {
      success: true,
      output: {
        subreddit: subredditName,
        posts
      }
    }
  },
  
  transformError: (error) => {
    return `Error fetching Reddit posts: ${error.message}`
  }
} 