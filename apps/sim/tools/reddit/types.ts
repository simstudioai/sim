import type { OutputProperty, ToolResponse } from '@/tools/types'

/**
 * Shared output property definitions for Reddit API responses.
 * Based on official Reddit API documentation: https://github.com/reddit-archive/reddit/wiki/JSON
 */

/**
 * Output definition for Reddit post (Link) objects.
 * Implements votable and created interfaces per Reddit API docs.
 */
export const POST_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Post ID' },
  title: { type: 'string', description: 'Post title (may contain newlines)' },
  author: { type: 'string', description: 'Poster account name (null for promotional links)' },
  url: { type: 'string', description: 'External link URL or self-post permalink' },
  permalink: { type: 'string', description: 'Relative permanent link URL' },
  created_utc: { type: 'number', description: 'Creation time in UTC epoch seconds' },
  score: { type: 'number', description: 'Net upvotes minus downvotes' },
  num_comments: { type: 'number', description: 'Total comments including removed ones' },
  is_self: { type: 'boolean', description: 'Indicates self-post vs external link' },
  selftext: {
    type: 'string',
    description: 'Unformatted post content with markup (self posts only)',
  },
  thumbnail: { type: 'string', description: 'Image URL or "self"/"image"/"default"' },
  subreddit: { type: 'string', description: 'Subreddit name without /r/ prefix' },
  subreddit_id: { type: 'string', description: 'Subreddit identifier' },
  domain: { type: 'string', description: 'Source domain; "self.<subreddit>" for self-posts' },
  over_18: { type: 'boolean', description: 'NSFW tag status' },
  locked: { type: 'boolean', description: 'Whether closed to new comments' },
  stickied: { type: 'boolean', description: 'Sticky post designation' },
  edited: { type: 'number', description: 'Edit timestamp or false if unedited' },
  distinguished: {
    type: 'string',
    description: 'Moderator/admin status: null/"moderator"/"admin"/"special"',
  },
  ups: { type: 'number', description: 'Upvote count' },
  downs: { type: 'number', description: 'Downvote count' },
  likes: {
    type: 'boolean',
    description: 'User vote: true (upvote), false (downvote), null (none)',
  },
  saved: { type: 'boolean', description: 'Whether user saved the post' },
  hidden: { type: 'boolean', description: 'Whether logged-in user hid the post' },
  author_flair_text: { type: 'string', description: 'Text displayed as author flair' },
  author_flair_css_class: { type: 'string', description: 'CSS styling for author flair' },
  link_flair_text: { type: 'string', description: 'Text for post flair' },
  link_flair_css_class: { type: 'string', description: 'CSS class for post flair' },
} as const satisfies Record<string, OutputProperty>

/**
 * Output definition for Reddit comment objects.
 * Implements votable and created interfaces per Reddit API docs.
 */
export const COMMENT_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Comment ID' },
  author: { type: 'string', description: 'Commenter account name' },
  body: { type: 'string', description: 'Raw unformatted comment text with markup characters' },
  body_html: { type: 'string', description: 'Formatted HTML version of comment' },
  created_utc: { type: 'number', description: 'Creation time in UTC epoch seconds' },
  score: { type: 'number', description: 'Net comment score' },
  permalink: { type: 'string', description: 'Comment permalink URL' },
  parent_id: { type: 'string', description: 'ID of parent (post or comment)' },
  link_id: { type: 'string', description: 'Parent post identifier' },
  subreddit: { type: 'string', description: 'Subreddit name without /r/ prefix' },
  subreddit_id: { type: 'string', description: 'Subreddit identifier' },
  edited: { type: 'number', description: 'UTC edit timestamp or false if unedited' },
  distinguished: {
    type: 'string',
    description: 'Distinction: null/"moderator"/"admin"/"special"',
  },
  ups: { type: 'number', description: 'Upvote count' },
  downs: { type: 'number', description: 'Downvote count' },
  likes: { type: 'boolean', description: 'User vote: true (up), false (down), null (none)' },
  saved: { type: 'boolean', description: 'User save status' },
  score_hidden: { type: 'boolean', description: 'Score visibility status' },
  gilded: { type: 'number', description: 'Reddit Gold awards received' },
  author_flair_text: { type: 'string', description: 'Author flair text' },
  author_flair_css_class: { type: 'string', description: 'CSS class for author flair' },
  link_author: { type: 'string', description: 'Parent post author (when outside original thread)' },
  link_title: { type: 'string', description: 'Parent post title (when outside original thread)' },
  link_url: { type: 'string', description: 'Parent post URL (when outside original thread)' },
} as const satisfies Record<string, OutputProperty>

/**
 * Simplified post output properties for listing responses (most commonly used fields)
 */
export const POST_LISTING_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Post ID' },
  title: { type: 'string', description: 'Post title' },
  author: { type: 'string', description: 'Author username' },
  url: { type: 'string', description: 'Post URL' },
  permalink: { type: 'string', description: 'Reddit permalink' },
  score: { type: 'number', description: 'Post score (upvotes - downvotes)' },
  num_comments: { type: 'number', description: 'Number of comments' },
  created_utc: { type: 'number', description: 'Creation timestamp (UTC)' },
  is_self: { type: 'boolean', description: 'Whether this is a text post' },
  selftext: { type: 'string', description: 'Text content for self posts' },
  thumbnail: { type: 'string', description: 'Thumbnail URL' },
  subreddit: { type: 'string', description: 'Subreddit name' },
} as const satisfies Record<string, OutputProperty>

/**
 * Simplified comment output properties for listing responses
 */
export const COMMENT_LISTING_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Comment ID' },
  author: { type: 'string', description: 'Comment author' },
  body: { type: 'string', description: 'Comment text' },
  score: { type: 'number', description: 'Comment score' },
  created_utc: { type: 'number', description: 'Creation timestamp' },
  permalink: { type: 'string', description: 'Comment permalink' },
} as const satisfies Record<string, OutputProperty>

/**
 * Comment with nested replies output definition
 */
export const COMMENT_WITH_REPLIES_OUTPUT_PROPERTIES = {
  ...COMMENT_LISTING_OUTPUT_PROPERTIES,
  replies: {
    type: 'array',
    description: 'Nested reply comments',
    items: { type: 'object', description: 'Nested comment with same structure' },
  },
} as const satisfies Record<string, OutputProperty>

/**
 * Post metadata output for get_comments tool
 */
export const POST_METADATA_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Post ID' },
  title: { type: 'string', description: 'Post title' },
  author: { type: 'string', description: 'Post author' },
  selftext: { type: 'string', description: 'Post text content' },
  score: { type: 'number', description: 'Post score' },
  created_utc: { type: 'number', description: 'Creation timestamp' },
  permalink: { type: 'string', description: 'Reddit permalink' },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete posts array output definition
 */
export const POSTS_ARRAY_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Array of posts with title, author, URL, score, comments count, and metadata',
  items: {
    type: 'object',
    properties: POST_LISTING_OUTPUT_PROPERTIES,
  },
}

/**
 * Complete comments array output definition with nested replies
 */
export const COMMENTS_ARRAY_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Nested comments with author, body, score, timestamps, and replies',
  items: {
    type: 'object',
    properties: COMMENT_WITH_REPLIES_OUTPUT_PROPERTIES,
  },
}

/**
 * Post metadata output definition for get_comments tool
 */
export const POST_METADATA_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Post information including ID, title, author, content, and metadata',
  properties: POST_METADATA_OUTPUT_PROPERTIES,
}

/**
 * Write operation success output properties
 */
export const WRITE_SUCCESS_OUTPUT_PROPERTIES = {
  success: { type: 'boolean', description: 'Whether the operation was successful' },
  message: { type: 'string', description: 'Success or error message' },
} as const satisfies Record<string, OutputProperty>

/**
 * Submit post response data output properties
 */
export const SUBMIT_POST_DATA_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'New post ID' },
  name: { type: 'string', description: 'Thing fullname (t3_xxxxx)' },
  url: { type: 'string', description: 'Post URL from API response' },
  permalink: { type: 'string', description: 'Full Reddit permalink' },
} as const satisfies Record<string, OutputProperty>

/**
 * Submit post data output definition
 */
export const SUBMIT_POST_DATA_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Post data including ID, name, URL, and permalink',
  properties: SUBMIT_POST_DATA_OUTPUT_PROPERTIES,
}

/**
 * Reply comment response data output properties
 */
export const REPLY_DATA_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'New comment ID' },
  name: { type: 'string', description: 'Thing fullname (t1_xxxxx)' },
  permalink: { type: 'string', description: 'Comment permalink' },
  body: { type: 'string', description: 'Comment body text' },
} as const satisfies Record<string, OutputProperty>

/**
 * Reply data output definition
 */
export const REPLY_DATA_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Comment data including ID, name, permalink, and body',
  properties: REPLY_DATA_OUTPUT_PROPERTIES,
}

/**
 * Edit response data output properties
 */
export const EDIT_DATA_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Edited thing ID' },
  body: { type: 'string', description: 'Updated comment body (for comments)' },
  selftext: { type: 'string', description: 'Updated post text (for self posts)' },
} as const satisfies Record<string, OutputProperty>

/**
 * Edit data output definition
 */
export const EDIT_DATA_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Updated content data',
  properties: EDIT_DATA_OUTPUT_PROPERTIES,
}

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
