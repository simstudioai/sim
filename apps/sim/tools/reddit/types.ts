import type { ToolResponse } from '@/tools/types'

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
  // Pagination parameters
  after?: string
  before?: string
  count?: number
  show?: string
  sr_detail?: boolean
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
  // Comment-specific parameters
  depth?: number
  context?: number
  showedits?: boolean
  showmore?: boolean
  showtitle?: boolean
  threaded?: boolean
  truncate?: number
  // Pagination parameters
  after?: string
  before?: string
  count?: number
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

// Parameters for controversial posts
export interface RedditControversialParams {
  subreddit: string
  time?: 'hour' | 'day' | 'week' | 'month' | 'year' | 'all'
  limit?: number
  after?: string
  before?: string
  count?: number
  show?: string
  sr_detail?: boolean
  accessToken?: string
}

// Parameters for search
export interface RedditSearchParams {
  subreddit: string
  query: string
  sort?: 'relevance' | 'hot' | 'top' | 'new' | 'comments'
  time?: 'hour' | 'day' | 'week' | 'month' | 'year' | 'all'
  limit?: number
  after?: string
  before?: string
  count?: number
  show?: string
  restrict_sr?: boolean
  accessToken?: string
}

// Parameters for submit post
export interface RedditSubmitParams {
  subreddit: string
  title: string
  text?: string
  url?: string
  nsfw?: boolean
  spoiler?: boolean
  send_replies?: boolean
  accessToken?: string
}

// Parameters for vote
export interface RedditVoteParams {
  id: string // Thing fullname (e.g., t3_xxxxx for post, t1_xxxxx for comment)
  dir: 1 | 0 | -1 // 1 = upvote, 0 = unvote, -1 = downvote
  accessToken?: string
}

// Parameters for save/unsave
export interface RedditSaveParams {
  id: string // Thing fullname
  category?: string // Save category
  accessToken?: string
}

// Parameters for reply
export interface RedditReplyParams {
  parent_id: string // Thing fullname to reply to
  text: string // Comment text in markdown
  accessToken?: string
}

// Parameters for edit
export interface RedditEditParams {
  thing_id: string // Thing fullname to edit
  text: string // New text in markdown
  accessToken?: string
}

// Parameters for delete
export interface RedditDeleteParams {
  id: string // Thing fullname to delete
  accessToken?: string
}

// Parameters for subscribe/unsubscribe
export interface RedditSubscribeParams {
  subreddit: string
  action: 'sub' | 'unsub'
  accessToken?: string
}

// Generic success response for write operations
export interface RedditWriteResponse extends ToolResponse {
  output: {
    success: boolean
    message?: string
    data?: any
  }
}

export type RedditResponse =
  | RedditHotPostsResponse
  | RedditPostsResponse
  | RedditCommentsResponse
  | RedditWriteResponse
