import { ToolResponse } from '../types'

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

export interface RedditHotPostsResponse extends ToolResponse {
  output: {
    subreddit: string
    posts: RedditPost[]
  }
}
