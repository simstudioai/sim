import { ToolResponse } from '../types'

// Common Types
export interface XTweet {
  id: string
  text: string
  createdAt: string
  authorId: string
  conversationId?: string
  inReplyToUserId?: string
  attachments?: {
    mediaKeys?: string[]
    pollId?: string
  }
}

export interface XUser {
  id: string
  username: string
  name: string
  description?: string
  profileImageUrl?: string
  verified: boolean
  metrics: {
    followersCount: number
    followingCount: number
    tweetCount: number
  }
}

// Write Operation
export interface XWriteParams {
  apiKey: string
  text: string
  replyTo?: string
  mediaIds?: string[]
  poll?: {
    options: string[]
    durationMinutes: number
  }
}

export interface XWriteResponse extends ToolResponse {
  output: {
    tweet: XTweet
  }
}

// Read Operation
export interface XReadParams {
  apiKey: string
  tweetId: string
  includeReplies?: boolean
}

export interface XReadResponse extends ToolResponse {
  output: {
    tweet: XTweet
    replies?: XTweet[]
    context?: {
      parentTweet?: XTweet
      rootTweet?: XTweet
    }
  }
}

// Search Operation
export interface XSearchParams {
  apiKey: string
  query: string
  maxResults?: number
  startTime?: string
  endTime?: string
  sortOrder?: 'recency' | 'relevancy'
}

export interface XSearchResponse extends ToolResponse {
  output: {
    tweets: XTweet[]
    includes?: {
      users: XUser[]
      media: any[]
      polls: any[]
    }
    meta: {
      resultCount: number
      newestId: string
      oldestId: string
      nextToken?: string
    }
  }
}

// User Operation
export interface XUserParams {
  apiKey: string
  username: string
  includeRecentTweets?: boolean
}

export interface XUserResponse extends ToolResponse {
  output: {
    user: XUser
    recentTweets?: XTweet[]
  }
}
