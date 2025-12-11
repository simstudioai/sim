import type { ToolResponse } from '@/tools/types'

/**
 * Context annotation domain from X API
 */
export interface XContextAnnotationDomain {
  id: string
  name: string
  description?: string
}

/**
 * Context annotation entity from X API
 */
export interface XContextAnnotationEntity {
  id: string
  name: string
  description?: string
}

/**
 * Context annotation from X API - provides semantic context about tweet content
 */
export interface XContextAnnotation {
  domain: XContextAnnotationDomain
  entity: XContextAnnotationEntity
}

/**
 * Tweet object from X API
 */
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
  contextAnnotations?: XContextAnnotation[]
  publicMetrics?: {
    retweetCount: number
    replyCount: number
    likeCount: number
    quoteCount: number
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

// Common parameters for all X endpoints
export interface XBaseParams {
  accessToken: string
}

// Write Operation
export interface XWriteParams extends XBaseParams {
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
export interface XReadParams extends XBaseParams {
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
export interface XSearchParams extends XBaseParams {
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
export interface XUserParams extends XBaseParams {
  username: string
  includeRecentTweets?: boolean
}

export interface XUserResponse extends ToolResponse {
  output: {
    user: XUser
    recentTweets?: XTweet[]
  }
}

export type XResponse = XWriteResponse | XReadResponse | XSearchResponse | XUserResponse

/**
 * Transforms raw X API tweet data (snake_case) into the XTweet format (camelCase)
 */
export const transformTweet = (tweet: any): XTweet => ({
  id: tweet.id,
  text: tweet.text,
  createdAt: tweet.created_at,
  authorId: tweet.author_id,
  conversationId: tweet.conversation_id,
  inReplyToUserId: tweet.in_reply_to_user_id,
  attachments: {
    mediaKeys: tweet.attachments?.media_keys,
    pollId: tweet.attachments?.poll_ids?.[0],
  },
  contextAnnotations: tweet.context_annotations,
  publicMetrics: tweet.public_metrics
    ? {
        retweetCount: tweet.public_metrics.retweet_count,
        replyCount: tweet.public_metrics.reply_count,
        likeCount: tweet.public_metrics.like_count,
        quoteCount: tweet.public_metrics.quote_count,
      }
    : undefined,
})

/**
 * Transforms raw X API user data (snake_case) into the XUser format (camelCase)
 */
export const transformUser = (user: any): XUser => ({
  id: user.id,
  username: user.username,
  name: user.name || '',
  description: user.description || '',
  profileImageUrl: user.profile_image_url || '',
  verified: !!user.verified,
  metrics: {
    followersCount: user.public_metrics?.followers_count || 0,
    followingCount: user.public_metrics?.following_count || 0,
    tweetCount: user.public_metrics?.tweet_count || 0,
  },
})
