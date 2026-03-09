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

/**
 * Trend object from X API (WOEID trends)
 */
export interface XTrend {
  trendName: string
  tweetCount: number | null
}

/**
 * Personalized trend object from X API
 */
export interface XPersonalizedTrend {
  trendName: string
  postCount: number | null
  category: string | null
  trendingSince: string | null
}

/**
 * Transforms raw X API trend data (WOEID) into the XTrend format
 */
export const transformTrend = (trend: any): XTrend => ({
  trendName: trend.trend_name ?? trend.name ?? '',
  tweetCount: trend.tweet_count ?? null,
})

/**
 * Transforms raw X API personalized trend data into the XPersonalizedTrend format
 */
export const transformPersonalizedTrend = (trend: any): XPersonalizedTrend => ({
  trendName: trend.trend_name ?? '',
  postCount: trend.post_count ?? null,
  category: trend.category ?? null,
  trendingSince: trend.trending_since ?? null,
})

// --- New Tool Parameter Interfaces ---

export interface XSearchTweetsParams extends XBaseParams {
  query: string
  maxResults?: number
  startTime?: string
  endTime?: string
  sinceId?: string
  untilId?: string
  sortOrder?: string
  nextToken?: string
}

export interface XGetUserTweetsParams extends XBaseParams {
  userId: string
  maxResults?: number
  startTime?: string
  endTime?: string
  sinceId?: string
  untilId?: string
  exclude?: string
  paginationToken?: string
}

export interface XGetUserMentionsParams extends XBaseParams {
  userId: string
  maxResults?: number
  startTime?: string
  endTime?: string
  sinceId?: string
  untilId?: string
  paginationToken?: string
}

export interface XGetUserTimelineParams extends XBaseParams {
  userId: string
  maxResults?: number
  startTime?: string
  endTime?: string
  sinceId?: string
  untilId?: string
  exclude?: string
  paginationToken?: string
}

export interface XGetTweetsByIdsParams extends XBaseParams {
  ids: string
}

export interface XGetTweetsByIdsResponse extends ToolResponse {
  output: {
    tweets: XTweet[]
  }
}

export interface XGetBookmarksParams extends XBaseParams {
  userId: string
  maxResults?: number
  paginationToken?: string
}

export interface XCreateBookmarkParams extends XBaseParams {
  userId: string
  tweetId: string
}

export interface XCreateBookmarkResponse extends ToolResponse {
  output: {
    bookmarked: boolean
  }
}

export interface XDeleteBookmarkParams extends XBaseParams {
  userId: string
  tweetId: string
}

export interface XDeleteBookmarkResponse extends ToolResponse {
  output: {
    bookmarked: boolean
  }
}

export interface XCreateTweetParams extends XBaseParams {
  text: string
  replyToTweetId?: string
  quoteTweetId?: string
  mediaIds?: string
  replySettings?: string
}

export interface XCreateTweetResponse extends ToolResponse {
  output: {
    id: string
    text: string
  }
}

export interface XDeleteTweetParams extends XBaseParams {
  tweetId: string
}

export interface XDeleteTweetResponse extends ToolResponse {
  output: {
    deleted: boolean
  }
}

export interface XGetMeParams extends XBaseParams {}

export interface XGetMeResponse extends ToolResponse {
  output: {
    user: XUser
  }
}

export interface XSearchUsersParams extends XBaseParams {
  query: string
  maxResults?: number
  nextToken?: string
}

export interface XGetFollowersParams extends XBaseParams {
  userId: string
  maxResults?: number
  paginationToken?: string
}

export interface XGetFollowingParams extends XBaseParams {
  userId: string
  maxResults?: number
  paginationToken?: string
}

export interface XManageFollowParams extends XBaseParams {
  userId: string
  targetUserId: string
  action: string
}

export interface XManageFollowResponse extends ToolResponse {
  output: {
    following: boolean
    pendingFollow: boolean
  }
}

export interface XGetBlockingParams extends XBaseParams {
  userId: string
  maxResults?: number
  paginationToken?: string
}

export interface XManageBlockParams extends XBaseParams {
  userId: string
  targetUserId: string
  action: string
}

export interface XManageBlockResponse extends ToolResponse {
  output: {
    blocking: boolean
  }
}

export interface XGetLikedTweetsParams extends XBaseParams {
  userId: string
  maxResults?: number
  paginationToken?: string
}

export interface XGetLikingUsersParams extends XBaseParams {
  tweetId: string
  maxResults?: number
  paginationToken?: string
}

export interface XManageLikeParams extends XBaseParams {
  userId: string
  tweetId: string
  action: string
}

export interface XManageLikeResponse extends ToolResponse {
  output: {
    liked: boolean
  }
}

export interface XManageRetweetParams extends XBaseParams {
  userId: string
  tweetId: string
  action: string
}

export interface XManageRetweetResponse extends ToolResponse {
  output: {
    retweeted: boolean
  }
}

export interface XGetRetweetedByParams extends XBaseParams {
  tweetId: string
  maxResults?: number
  paginationToken?: string
}

export interface XGetQuoteTweetsParams extends XBaseParams {
  tweetId: string
  maxResults?: number
  paginationToken?: string
}

export interface XGetTrendsByWoeidParams extends XBaseParams {
  woeid: string
  maxTrends?: number
}

export interface XGetPersonalizedTrendsParams extends XBaseParams {}

export interface XGetUsageParams extends XBaseParams {
  days?: number
}

export interface XGetUsageResponse extends ToolResponse {
  output: {
    capResetDay: number | null
    projectId: string
    projectCap: number | null
    projectUsage: number | null
    dailyProjectUsage: Array<{ date: string; usage: number }>
    dailyClientAppUsage: Array<{
      clientAppId: string
      usage: Array<{ date: string; usage: number }>
    }>
  }
}

export interface XHideReplyParams extends XBaseParams {
  tweetId: string
  hidden: boolean
}

export interface XHideReplyResponse extends ToolResponse {
  output: {
    hidden: boolean
  }
}

export interface XManageMuteParams extends XBaseParams {
  userId: string
  targetUserId: string
  action: string
}

export interface XManageMuteResponse extends ToolResponse {
  output: {
    muting: boolean
  }
}

// Common response types for list endpoints
export interface XTweetListResponse extends ToolResponse {
  output: {
    tweets: XTweet[]
    includes?: {
      users: XUser[]
    }
    meta: {
      resultCount: number
      newestId: string | null
      oldestId: string | null
      nextToken: string | null
      previousToken: string | null
    }
  }
}

export interface XUserListResponse extends ToolResponse {
  output: {
    users: XUser[]
    meta: {
      resultCount: number
      nextToken: string | null
    }
  }
}

export interface XTrendListResponse extends ToolResponse {
  output: {
    trends: XTrend[]
  }
}

export interface XPersonalizedTrendListResponse extends ToolResponse {
  output: {
    trends: XPersonalizedTrend[]
  }
}
