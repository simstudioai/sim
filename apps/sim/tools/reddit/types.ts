import type { ToolResponse } from '../types'

export interface RedditPost {
  id: string
  title: string
  author: string
  url: string
  permalink: string
  created_utc: number
  score: number
  num_comments: number
  selftext?: string
  thumbnail?: string
  is_self: boolean
  subreddit: string
  subreddit_name_prefixed: string
}

export interface RedditComment {
  id: string
  author: string
  body: string
  created_utc: number
  score: number
  permalink: string
  replies: RedditComment[]
}

export interface RedditHotPostsResponse extends ToolResponse {
  output: {
    subreddit: string
    posts: RedditPost[]
  }
}

// Parameters for the generalized get_posts tool
export interface RedditPostsParams {
  subreddit: string
  sort?: 'hot' | 'new' | 'top' | 'rising'
  limit?: number
  time?: 'day' | 'week' | 'month' | 'year' | 'all'
  accessToken?: string
}

// Response for the generalized get_posts tool
export interface RedditPostsResponse extends ToolResponse {
  output: {
    subreddit: string
    posts: RedditPost[]
  }
}

// Parameters for the get_comments tool
export interface RedditCommentsParams {
  postId: string
  subreddit: string
  sort?: 'confidence' | 'top' | 'new' | 'controversial' | 'old' | 'random' | 'qa'
  limit?: number
  accessToken?: string
}

// Response for the get_comments tool
export interface RedditCommentsResponse extends ToolResponse {
  output: {
    post: {
      id: string
      title: string
      author: string
      selftext?: string
      created_utc: number
      score: number
      permalink: string
    }
    comments: RedditComment[]
  }
}
