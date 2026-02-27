import { xIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'

export const XBlock: BlockConfig = {
  type: 'x',
  name: 'X',
  description: 'Interact with X',
  authMode: AuthMode.OAuth,
  longDescription:
    'Integrate X into the workflow. Search tweets, manage bookmarks, follow/block/mute users, like and retweet, view trends, and more.',
  docsLink: 'https://docs.sim.ai/tools/x',
  category: 'tools',
  bgColor: '#000000',
  icon: xIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        // Tweet Operations
        { label: 'Create Tweet', id: 'x_create_tweet' },
        { label: 'Delete Tweet', id: 'x_delete_tweet' },
        { label: 'Search Tweets', id: 'x_search_tweets' },
        { label: 'Get Tweets by IDs', id: 'x_get_tweets_by_ids' },
        { label: 'Get Quote Tweets', id: 'x_get_quote_tweets' },
        { label: 'Hide Reply', id: 'x_hide_reply' },
        // User Tweet Operations
        { label: 'Get User Tweets', id: 'x_get_user_tweets' },
        { label: 'Get User Mentions', id: 'x_get_user_mentions' },
        { label: 'Get User Timeline', id: 'x_get_user_timeline' },
        // Engagement Operations
        { label: 'Like / Unlike', id: 'x_manage_like' },
        { label: 'Retweet / Unretweet', id: 'x_manage_retweet' },
        { label: 'Get Liked Tweets', id: 'x_get_liked_tweets' },
        { label: 'Get Liking Users', id: 'x_get_liking_users' },
        { label: 'Get Retweeted By', id: 'x_get_retweeted_by' },
        // Bookmark Operations
        { label: 'Get Bookmarks', id: 'x_get_bookmarks' },
        { label: 'Create Bookmark', id: 'x_create_bookmark' },
        { label: 'Delete Bookmark', id: 'x_delete_bookmark' },
        // User Operations
        { label: 'Get My Profile', id: 'x_get_me' },
        { label: 'Search Users', id: 'x_search_users' },
        { label: 'Get Followers', id: 'x_get_followers' },
        { label: 'Get Following', id: 'x_get_following' },
        // User Relationship Operations
        { label: 'Follow / Unfollow', id: 'x_manage_follow' },
        { label: 'Block / Unblock', id: 'x_manage_block' },
        { label: 'Get Blocked Users', id: 'x_get_blocking' },
        { label: 'Mute / Unmute', id: 'x_manage_mute' },
        // Trends Operations
        { label: 'Get Trends by Location', id: 'x_get_trends_by_woeid' },
        { label: 'Get Personalized Trends', id: 'x_get_personalized_trends' },
        // Usage Operations
        { label: 'Get API Usage', id: 'x_get_usage' },
      ],
      value: () => 'x_create_tweet',
    },
    // --- OAuth Credential ---
    {
      id: 'credential',
      title: 'X Account',
      type: 'oauth-input',
      serviceId: 'x',
      canonicalParamId: 'oauthCredential',
      mode: 'basic',
      requiredScopes: [
        'tweet.read',
        'tweet.write',
        'tweet.moderate.write',
        'users.read',
        'follows.read',
        'follows.write',
        'bookmark.read',
        'bookmark.write',
        'like.read',
        'like.write',
        'block.read',
        'block.write',
        'mute.read',
        'mute.write',
        'offline.access',
      ],
      placeholder: 'Select X account',
    },
    {
      id: 'manualCredential',
      title: 'X Account',
      type: 'short-input',
      canonicalParamId: 'oauthCredential',
      mode: 'advanced',
      placeholder: 'Enter credential ID',
    },
    // --- Create Tweet fields ---
    {
      id: 'text',
      title: 'Tweet Text',
      type: 'long-input',
      placeholder: "What's happening?",
      condition: { field: 'operation', value: 'x_create_tweet' },
      required: true,
    },
    {
      id: 'replyToTweetId',
      title: 'Reply To Tweet ID',
      type: 'short-input',
      placeholder: 'Enter tweet ID to reply to',
      condition: { field: 'operation', value: 'x_create_tweet' },
    },
    {
      id: 'quoteTweetId',
      title: 'Quote Tweet ID',
      type: 'short-input',
      placeholder: 'Enter tweet ID to quote',
      condition: { field: 'operation', value: 'x_create_tweet' },
    },
    {
      id: 'mediaIds',
      title: 'Media IDs',
      type: 'short-input',
      placeholder: 'Comma-separated media IDs (up to 4)',
      condition: { field: 'operation', value: 'x_create_tweet' },
    },
    {
      id: 'replySettings',
      title: 'Reply Settings',
      type: 'dropdown',
      options: [
        { label: 'Everyone', id: '' },
        { label: 'Mentioned Users', id: 'mentionedUsers' },
        { label: 'Following', id: 'following' },
        { label: 'Subscribers', id: 'subscribers' },
        { label: 'Verified', id: 'verified' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'x_create_tweet' },
    },
    // --- Tweet ID field (shared by multiple operations) ---
    {
      id: 'tweetId',
      title: 'Tweet ID',
      type: 'short-input',
      placeholder: 'Enter tweet ID',
      condition: {
        field: 'operation',
        value: [
          'x_delete_tweet',
          'x_get_quote_tweets',
          'x_hide_reply',
          'x_manage_like',
          'x_manage_retweet',
          'x_get_liking_users',
          'x_get_retweeted_by',
          'x_create_bookmark',
          'x_delete_bookmark',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'x_delete_tweet',
          'x_get_quote_tweets',
          'x_hide_reply',
          'x_manage_like',
          'x_manage_retweet',
          'x_get_liking_users',
          'x_get_retweeted_by',
          'x_create_bookmark',
          'x_delete_bookmark',
        ],
      },
    },
    // --- Hide Reply toggle ---
    {
      id: 'hidden',
      title: 'Hidden',
      type: 'dropdown',
      options: [
        { label: 'Hide', id: 'true' },
        { label: 'Unhide', id: 'false' },
      ],
      value: () => 'true',
      condition: { field: 'operation', value: 'x_hide_reply' },
    },
    // --- Tweet IDs (batch lookup) ---
    {
      id: 'ids',
      title: 'Tweet IDs',
      type: 'long-input',
      placeholder: 'Comma-separated tweet IDs (up to 100)',
      condition: { field: 'operation', value: 'x_get_tweets_by_ids' },
      required: true,
    },
    // --- Search query fields ---
    {
      id: 'query',
      title: 'Search Query',
      type: 'long-input',
      placeholder: 'Enter search terms (supports X search operators)',
      condition: { field: 'operation', value: ['x_search_tweets', 'x_search_users'] },
      required: { field: 'operation', value: ['x_search_tweets', 'x_search_users'] },
    },
    {
      id: 'sortOrder',
      title: 'Sort Order',
      type: 'dropdown',
      options: [
        { label: 'Recent', id: 'recency' },
        { label: 'Relevant', id: 'relevancy' },
      ],
      value: () => 'recency',
      condition: { field: 'operation', value: 'x_search_tweets' },
    },
    // --- User ID field (shared by many operations) ---
    {
      id: 'userId',
      title: 'User ID',
      type: 'short-input',
      placeholder: 'Enter user ID',
      condition: {
        field: 'operation',
        value: [
          'x_get_user_tweets',
          'x_get_user_mentions',
          'x_get_user_timeline',
          'x_get_liked_tweets',
          'x_get_bookmarks',
          'x_create_bookmark',
          'x_delete_bookmark',
          'x_get_followers',
          'x_get_following',
          'x_get_blocking',
          'x_manage_follow',
          'x_manage_block',
          'x_manage_mute',
          'x_manage_like',
          'x_manage_retweet',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'x_get_user_tweets',
          'x_get_user_mentions',
          'x_get_user_timeline',
          'x_get_liked_tweets',
          'x_get_bookmarks',
          'x_create_bookmark',
          'x_delete_bookmark',
          'x_get_followers',
          'x_get_following',
          'x_get_blocking',
          'x_manage_follow',
          'x_manage_block',
          'x_manage_mute',
          'x_manage_like',
          'x_manage_retweet',
        ],
      },
    },
    // --- Target User ID (for follow/block/mute) ---
    {
      id: 'targetUserId',
      title: 'Target User ID',
      type: 'short-input',
      placeholder: 'Enter target user ID',
      condition: {
        field: 'operation',
        value: ['x_manage_follow', 'x_manage_block', 'x_manage_mute'],
      },
      required: {
        field: 'operation',
        value: ['x_manage_follow', 'x_manage_block', 'x_manage_mute'],
      },
    },
    // --- Action dropdowns for manage operations ---
    {
      id: 'action',
      title: 'Action',
      type: 'dropdown',
      options: [
        { label: 'Like', id: 'like' },
        { label: 'Unlike', id: 'unlike' },
      ],
      value: () => 'like',
      condition: { field: 'operation', value: 'x_manage_like' },
    },
    {
      id: 'retweetAction',
      title: 'Action',
      type: 'dropdown',
      options: [
        { label: 'Retweet', id: 'retweet' },
        { label: 'Unretweet', id: 'unretweet' },
      ],
      value: () => 'retweet',
      condition: { field: 'operation', value: 'x_manage_retweet' },
    },
    {
      id: 'followAction',
      title: 'Action',
      type: 'dropdown',
      options: [
        { label: 'Follow', id: 'follow' },
        { label: 'Unfollow', id: 'unfollow' },
      ],
      value: () => 'follow',
      condition: { field: 'operation', value: 'x_manage_follow' },
    },
    {
      id: 'blockAction',
      title: 'Action',
      type: 'dropdown',
      options: [
        { label: 'Block', id: 'block' },
        { label: 'Unblock', id: 'unblock' },
      ],
      value: () => 'block',
      condition: { field: 'operation', value: 'x_manage_block' },
    },
    {
      id: 'muteAction',
      title: 'Action',
      type: 'dropdown',
      options: [
        { label: 'Mute', id: 'mute' },
        { label: 'Unmute', id: 'unmute' },
      ],
      value: () => 'mute',
      condition: { field: 'operation', value: 'x_manage_mute' },
    },
    // --- Exclude filter (for user tweets/timeline) ---
    {
      id: 'exclude',
      title: 'Exclude',
      type: 'short-input',
      placeholder: 'Comma-separated: retweets, replies',
      condition: {
        field: 'operation',
        value: ['x_get_user_tweets', 'x_get_user_timeline'],
      },
    },
    // --- Time range fields (shared by tweet search and user tweet operations) ---
    {
      id: 'startTime',
      title: 'Start Time',
      type: 'short-input',
      placeholder: 'YYYY-MM-DDTHH:mm:ssZ',
      condition: {
        field: 'operation',
        value: [
          'x_search_tweets',
          'x_get_user_tweets',
          'x_get_user_mentions',
          'x_get_user_timeline',
        ],
      },
      wandConfig: {
        enabled: true,
        prompt: `Generate an ISO 8601 timestamp based on the user's description.
The timestamp should be in the format: YYYY-MM-DDTHH:mm:ssZ (UTC timezone).
Examples:
- "yesterday" -> Calculate yesterday's date at 00:00:00Z
- "last week" -> Calculate 7 days ago at 00:00:00Z
- "beginning of this month" -> Calculate the 1st of current month at 00:00:00Z
- "2 hours ago" -> Calculate the timestamp 2 hours before now

Return ONLY the timestamp string - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the start time (e.g., "last week", "yesterday")...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'endTime',
      title: 'End Time',
      type: 'short-input',
      placeholder: 'YYYY-MM-DDTHH:mm:ssZ',
      condition: {
        field: 'operation',
        value: [
          'x_search_tweets',
          'x_get_user_tweets',
          'x_get_user_mentions',
          'x_get_user_timeline',
        ],
      },
      wandConfig: {
        enabled: true,
        prompt: `Generate an ISO 8601 timestamp based on the user's description.
The timestamp should be in the format: YYYY-MM-DDTHH:mm:ssZ (UTC timezone).
Examples:
- "now" -> Current timestamp
- "today" -> Today's date at 23:59:59Z
- "end of this week" -> Calculate the end of current week at 23:59:59Z
- "yesterday evening" -> Calculate yesterday at 23:59:59Z

Return ONLY the timestamp string - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the end time (e.g., "now", "end of today")...',
        generationType: 'timestamp',
      },
    },
    // --- Max Results (shared by many operations) ---
    {
      id: 'maxResults',
      title: 'Max Results',
      type: 'short-input',
      placeholder: '10',
      condition: {
        field: 'operation',
        value: [
          'x_search_tweets',
          'x_get_user_tweets',
          'x_get_user_mentions',
          'x_get_user_timeline',
          'x_get_liked_tweets',
          'x_get_bookmarks',
          'x_get_quote_tweets',
          'x_get_liking_users',
          'x_get_retweeted_by',
          'x_search_users',
          'x_get_followers',
          'x_get_following',
          'x_get_blocking',
        ],
      },
    },
    // --- Pagination Token (shared by many operations) ---
    {
      id: 'paginationToken',
      title: 'Pagination Token',
      type: 'short-input',
      placeholder: 'Token for next page',
      condition: {
        field: 'operation',
        value: [
          'x_get_user_tweets',
          'x_get_user_mentions',
          'x_get_user_timeline',
          'x_get_liked_tweets',
          'x_get_bookmarks',
          'x_get_quote_tweets',
          'x_get_liking_users',
          'x_get_retweeted_by',
          'x_get_followers',
          'x_get_following',
          'x_get_blocking',
        ],
      },
    },
    // --- Next Token (for search operations that use nextToken instead of paginationToken) ---
    {
      id: 'nextToken',
      title: 'Pagination Token',
      type: 'short-input',
      placeholder: 'Token for next page',
      condition: {
        field: 'operation',
        value: ['x_search_tweets', 'x_search_users'],
      },
    },
    // --- Trends fields ---
    {
      id: 'woeid',
      title: 'WOEID',
      type: 'short-input',
      placeholder: '1 (worldwide), 23424977 (US)',
      condition: { field: 'operation', value: 'x_get_trends_by_woeid' },
      required: true,
    },
    {
      id: 'maxTrends',
      title: 'Max Trends',
      type: 'short-input',
      placeholder: '20',
      condition: { field: 'operation', value: 'x_get_trends_by_woeid' },
    },
    // --- Usage fields ---
    {
      id: 'days',
      title: 'Days',
      type: 'short-input',
      placeholder: '7 (1-90)',
      condition: { field: 'operation', value: 'x_get_usage' },
    },
  ],
  tools: {
    access: [
      'x_create_tweet',
      'x_delete_tweet',
      'x_search_tweets',
      'x_get_tweets_by_ids',
      'x_get_quote_tweets',
      'x_hide_reply',
      'x_get_user_tweets',
      'x_get_user_mentions',
      'x_get_user_timeline',
      'x_manage_like',
      'x_manage_retweet',
      'x_get_liked_tweets',
      'x_get_liking_users',
      'x_get_retweeted_by',
      'x_get_bookmarks',
      'x_create_bookmark',
      'x_delete_bookmark',
      'x_get_me',
      'x_search_users',
      'x_get_followers',
      'x_get_following',
      'x_manage_follow',
      'x_manage_block',
      'x_get_blocking',
      'x_manage_mute',
      'x_get_trends_by_woeid',
      'x_get_personalized_trends',
      'x_get_usage',
    ],
    config: {
      tool: (params) => params.operation,
      params: (params) => {
        const { oauthCredential, ...rest } = params

        const parsedParams: Record<string, unknown> = {
          credential: oauthCredential,
        }

        for (const [key, value] of Object.entries(rest)) {
          if (value === undefined || value === null || value === '') continue

          if (key === 'maxResults' || key === 'maxTrends' || key === 'days') {
            parsedParams[key] = Number.parseInt(value as string, 10)
          } else if (key === 'hidden') {
            parsedParams[key] = value === 'true'
          } else if (key === 'retweetAction') {
            parsedParams.action = value
          } else if (key === 'followAction') {
            parsedParams.action = value
          } else if (key === 'blockAction') {
            parsedParams.action = value
          } else if (key === 'muteAction') {
            parsedParams.action = value
          } else {
            parsedParams[key] = value
          }
        }

        return parsedParams
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    oauthCredential: { type: 'string', description: 'X account credential' },
    // Tweet fields
    text: { type: 'string', description: 'Tweet text content' },
    replyToTweetId: { type: 'string', description: 'Tweet ID to reply to' },
    quoteTweetId: { type: 'string', description: 'Tweet ID to quote' },
    mediaIds: { type: 'string', description: 'Comma-separated media IDs' },
    replySettings: { type: 'string', description: 'Reply permission setting' },
    tweetId: { type: 'string', description: 'Tweet identifier' },
    ids: { type: 'string', description: 'Comma-separated tweet IDs' },
    hidden: { type: 'string', description: 'Hide or unhide reply' },
    // User fields
    userId: { type: 'string', description: 'User identifier' },
    targetUserId: { type: 'string', description: 'Target user identifier' },
    // Action fields
    action: { type: 'string', description: 'Action to perform (like/unlike, etc.)' },
    retweetAction: { type: 'string', description: 'Retweet action' },
    followAction: { type: 'string', description: 'Follow action' },
    blockAction: { type: 'string', description: 'Block action' },
    muteAction: { type: 'string', description: 'Mute action' },
    // Search/filter fields
    query: { type: 'string', description: 'Search query' },
    sortOrder: { type: 'string', description: 'Sort order' },
    exclude: { type: 'string', description: 'Exclusion filter' },
    // Time/pagination fields
    startTime: { type: 'string', description: 'Start time filter' },
    endTime: { type: 'string', description: 'End time filter' },
    maxResults: { type: 'number', description: 'Maximum results' },
    paginationToken: { type: 'string', description: 'Pagination token' },
    nextToken: { type: 'string', description: 'Next page token' },
    // Trends fields
    woeid: { type: 'string', description: 'Where On Earth ID' },
    maxTrends: { type: 'number', description: 'Maximum trends to return' },
    // Usage fields
    days: { type: 'number', description: 'Days of usage data' },
  },
  outputs: {
    // Create Tweet outputs
    id: {
      type: 'string',
      description: 'Created tweet ID',
      condition: { field: 'operation', value: 'x_create_tweet' },
    },
    text: {
      type: 'string',
      description: 'Text of the created tweet',
      condition: { field: 'operation', value: 'x_create_tweet' },
    },
    // Delete Tweet output
    deleted: {
      type: 'boolean',
      description: 'Whether the tweet was deleted',
      condition: { field: 'operation', value: 'x_delete_tweet' },
    },
    // Bookmark outputs
    bookmarked: {
      type: 'boolean',
      description: 'Whether the tweet is bookmarked',
      condition: { field: 'operation', value: ['x_create_bookmark', 'x_delete_bookmark'] },
    },
    // Hide Reply output
    hidden: {
      type: 'boolean',
      description: 'Whether the reply is hidden',
      condition: { field: 'operation', value: 'x_hide_reply' },
    },
    // Like output
    liked: {
      type: 'boolean',
      description: 'Whether the tweet is liked',
      condition: { field: 'operation', value: 'x_manage_like' },
    },
    // Retweet output
    retweeted: {
      type: 'boolean',
      description: 'Whether the tweet is retweeted',
      condition: { field: 'operation', value: 'x_manage_retweet' },
    },
    // Follow output
    following: {
      type: 'boolean',
      description: 'Whether following the user',
      condition: { field: 'operation', value: 'x_manage_follow' },
    },
    pendingFollow: {
      type: 'boolean',
      description: 'Whether a follow request is pending',
      condition: { field: 'operation', value: 'x_manage_follow' },
    },
    // Block output
    blocking: {
      type: 'boolean',
      description: 'Whether blocking the user',
      condition: { field: 'operation', value: 'x_manage_block' },
    },
    // Mute output
    muting: {
      type: 'boolean',
      description: 'Whether muting the user',
      condition: { field: 'operation', value: 'x_manage_mute' },
    },
    // Tweet list outputs (shared by many operations)
    tweets: {
      type: 'json',
      description: 'Array of tweets',
      condition: {
        field: 'operation',
        value: [
          'x_search_tweets',
          'x_get_tweets_by_ids',
          'x_get_user_tweets',
          'x_get_user_mentions',
          'x_get_user_timeline',
          'x_get_liked_tweets',
          'x_get_bookmarks',
          'x_get_quote_tweets',
        ],
      },
    },
    // User list outputs
    users: {
      type: 'json',
      description: 'Array of users',
      condition: {
        field: 'operation',
        value: [
          'x_search_users',
          'x_get_followers',
          'x_get_following',
          'x_get_blocking',
          'x_get_liking_users',
          'x_get_retweeted_by',
        ],
      },
    },
    // Single user output
    user: {
      type: 'json',
      description: 'User profile data',
      condition: { field: 'operation', value: 'x_get_me' },
    },
    // Pagination metadata
    meta: {
      type: 'json',
      description: 'Pagination metadata (resultCount, nextToken)',
      condition: {
        field: 'operation',
        value: [
          'x_search_tweets',
          'x_get_user_tweets',
          'x_get_user_mentions',
          'x_get_user_timeline',
          'x_get_liked_tweets',
          'x_get_bookmarks',
          'x_get_quote_tweets',
          'x_get_liking_users',
          'x_get_retweeted_by',
          'x_search_users',
          'x_get_followers',
          'x_get_following',
          'x_get_blocking',
        ],
      },
    },
    // Trends outputs
    trends: {
      type: 'json',
      description: 'Array of trending topics',
      condition: {
        field: 'operation',
        value: ['x_get_trends_by_woeid', 'x_get_personalized_trends'],
      },
    },
    // Usage outputs
    capResetDay: {
      type: 'number',
      description: 'Day of month when usage cap resets',
      condition: { field: 'operation', value: 'x_get_usage' },
    },
    projectId: {
      type: 'string',
      description: 'Project identifier',
      condition: { field: 'operation', value: 'x_get_usage' },
    },
    projectCap: {
      type: 'number',
      description: 'Monthly project usage cap',
      condition: { field: 'operation', value: 'x_get_usage' },
    },
    projectUsage: {
      type: 'number',
      description: 'Current project usage count',
      condition: { field: 'operation', value: 'x_get_usage' },
    },
    dailyProjectUsage: {
      type: 'json',
      description: 'Daily usage breakdown',
      condition: { field: 'operation', value: 'x_get_usage' },
    },
    dailyClientAppUsage: {
      type: 'json',
      description: 'Daily client app usage breakdown',
      condition: { field: 'operation', value: 'x_get_usage' },
    },
  },
}
