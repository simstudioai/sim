import { createLogger } from '@sim/logger'
import { RedditIcon } from '@/components/icons'
import { toError } from '@/lib/core/utils/helpers'
import { fetchWithRetry, VALIDATE_RETRY_OPTIONS } from '@/lib/knowledge/documents/utils'
import type { ConnectorConfig, ExternalDocument, ExternalDocumentList } from '@/connectors/types'
import { parseTagDate } from '@/connectors/utils'

const logger = createLogger('RedditConnector')

const REDDIT_API_BASE = 'https://oauth.reddit.com'
const REDDIT_USER_AGENT = 'sim-studio:v1.0.0 (knowledge-connector)'
const DEFAULT_MAX_POSTS = 200
const POSTS_PER_PAGE = 100
const COMMENTS_PER_POST = 15

interface RedditPost {
  kind: string
  data: {
    id: string
    name: string
    title: string
    selftext: string
    selftext_html?: string
    author: string
    score: number
    num_comments: number
    created_utc: number
    permalink: string
    url: string
    link_flair_text?: string
    subreddit: string
    is_self: boolean
    domain?: string
  }
}

interface RedditComment {
  kind: string
  data: {
    id: string
    author: string
    body: string
    score: number
    created_utc: number
    replies?: RedditListing | string
  }
}

interface RedditListing {
  kind: string
  data: {
    children: (RedditPost | RedditComment)[]
    after: string | null
  }
}

/**
 * Makes an authenticated request to the Reddit API.
 */
async function redditApiGet(
  path: string,
  accessToken: string,
  params?: Record<string, string>,
  retryOptions?: Parameters<typeof fetchWithRetry>[2]
): Promise<unknown> {
  const queryParams = params ? `?${new URLSearchParams(params).toString()}` : ''
  const url = `${REDDIT_API_BASE}${path}${queryParams}`

  const response = await fetchWithRetry(
    url,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'User-Agent': REDDIT_USER_AGENT,
        Accept: 'application/json',
      },
    },
    retryOptions
  )

  if (!response.ok) {
    throw new Error(`Reddit API HTTP error: ${response.status} ${response.statusText}`)
  }

  return response.json()
}

/**
 * Fetches top-level comments for a post, up to a maximum count.
 */
async function fetchPostComments(
  accessToken: string,
  subreddit: string,
  postId: string,
  maxComments: number
): Promise<string[]> {
  try {
    const data = (await redditApiGet(`/r/${subreddit}/comments/${postId}`, accessToken, {
      limit: String(maxComments),
      depth: '1',
      sort: 'top',
    })) as RedditListing[]

    if (!Array.isArray(data) || data.length < 2) return []

    return extractComments(data[1], maxComments)
  } catch (error) {
    logger.warn('Failed to fetch comments for post', {
      postId,
      error: toError(error).message,
    })
    return []
  }
}

/**
 * Extracts formatted comment strings from a Reddit comment listing.
 */
function extractComments(commentListing: RedditListing, maxComments: number): string[] {
  const comments: string[] = []

  for (const child of commentListing.data.children) {
    if (child.kind !== 't1') continue
    const comment = child as RedditComment
    if (!comment.data.body || comment.data.author === 'AutoModerator') continue
    comments.push(`[${comment.data.author} | score: ${comment.data.score}]: ${comment.data.body}`)
    if (comments.length >= maxComments) break
  }

  return comments
}

/**
 * Formats a Reddit post with its comments into a document content string.
 * When `prefetchedComments` is provided, uses those directly instead of fetching.
 */
async function formatPostContent(
  accessToken: string,
  post: RedditPost['data'],
  maxComments: number,
  prefetchedComments?: string[]
): Promise<string> {
  const lines: string[] = []

  lines.push(`# ${post.title}`)
  lines.push('')
  lines.push(`Author: u/${post.author}`)
  lines.push(`Score: ${post.score} | Comments: ${post.num_comments}`)
  lines.push(`Posted: ${new Date(post.created_utc * 1000).toISOString()}`)
  if (post.link_flair_text) {
    lines.push(`Flair: ${post.link_flair_text}`)
  }
  if (!post.is_self && post.url) {
    lines.push(`Link: ${post.url}`)
  }
  lines.push('')

  if (post.selftext) {
    lines.push(post.selftext)
    lines.push('')
  }

  if (maxComments > 0) {
    const comments =
      prefetchedComments ??
      (await fetchPostComments(accessToken, post.subreddit, post.id, maxComments))
    if (comments.length > 0) {
      lines.push('---')
      lines.push(`Top Comments (${comments.length}):`)
      lines.push('')
      for (const comment of comments) {
        lines.push(comment)
        lines.push('')
      }
    }
  }

  return lines.join('\n').trim()
}

/**
 * Fetches posts from a subreddit listing endpoint, handling pagination.
 */
async function fetchSubredditPosts(
  accessToken: string,
  subreddit: string,
  sort: string,
  timeFilter: string,
  maxPosts: number,
  afterCursor?: string
): Promise<{ posts: RedditPost['data'][]; after: string | null }> {
  const allPosts: RedditPost['data'][] = []
  let after: string | null = afterCursor ?? null

  while (allPosts.length < maxPosts) {
    const limit = Math.min(POSTS_PER_PAGE, maxPosts - allPosts.length)
    const params: Record<string, string> = { limit: String(limit) }

    if (after) {
      params.after = after
    }

    if (sort === 'top') {
      params.t = timeFilter
    }

    const data = (await redditApiGet(
      `/r/${subreddit}/${sort}`,
      accessToken,
      params
    )) as RedditListing

    const children = data.data.children as RedditPost[]
    if (children.length === 0) {
      after = null
      break
    }

    for (const child of children) {
      if (child.kind === 't3') {
        allPosts.push(child.data)
      }
    }

    after = data.data.after
    if (!after) break
  }

  return { posts: allPosts.slice(0, maxPosts), after }
}

/**
 * Resolves sort and time filter from source config.
 */
function resolveSortConfig(sourceConfig: Record<string, unknown>): {
  sort: string
  timeFilter: string
} {
  const sort = (sourceConfig.sort as string) || 'hot'
  const timeFilter = (sourceConfig.timeFilter as string) || 'week'
  return { sort, timeFilter }
}

export const redditConnector: ConnectorConfig = {
  id: 'reddit',
  name: 'Reddit',
  description: 'Sync subreddit posts and comments from Reddit into your knowledge base',
  version: '1.0.0',
  icon: RedditIcon,

  auth: {
    mode: 'oauth',
    provider: 'reddit',
    requiredScopes: ['read'],
  },

  configFields: [
    {
      id: 'subreddit',
      title: 'Subreddit',
      type: 'short-input',
      placeholder: 'e.g. machinelearning',
      required: true,
      description: 'Subreddit name to sync posts from (without r/ prefix)',
    },
    {
      id: 'sort',
      title: 'Sort',
      type: 'dropdown',
      required: false,
      description: 'How to sort posts',
      options: [
        { label: 'Hot', id: 'hot' },
        { label: 'New', id: 'new' },
        { label: 'Top', id: 'top' },
        { label: 'Rising', id: 'rising' },
      ],
    },
    {
      id: 'timeFilter',
      title: 'Time Filter',
      type: 'dropdown',
      required: false,
      description: 'Time range for top posts (only applies when sort is "Top")',
      options: [
        { label: 'Past Day', id: 'day' },
        { label: 'Past Week', id: 'week' },
        { label: 'Past Month', id: 'month' },
        { label: 'Past Year', id: 'year' },
        { label: 'All Time', id: 'all' },
      ],
    },
    {
      id: 'maxPosts',
      title: 'Max Posts',
      type: 'short-input',
      required: false,
      placeholder: `e.g. 100 (default: ${DEFAULT_MAX_POSTS})`,
      description: 'Maximum number of posts to sync',
    },
  ],

  listDocuments: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    cursor?: string
  ): Promise<ExternalDocumentList> => {
    const subreddit = (sourceConfig.subreddit as string)?.trim().replace(/^r\//, '')
    if (!subreddit) {
      throw new Error('Subreddit is required')
    }

    const { sort, timeFilter } = resolveSortConfig(sourceConfig)
    const maxPosts = sourceConfig.maxPosts ? Number(sourceConfig.maxPosts) : DEFAULT_MAX_POSTS

    logger.info('Syncing Reddit subreddit', { subreddit, sort, timeFilter, maxPosts })

    // Parse cursor: "after:TOKEN:collected:N" format
    let afterToken: string | undefined
    let collectedSoFar = 0
    if (cursor) {
      const parts = cursor.split(':')
      if (parts.length >= 4) {
        afterToken = parts[1] || undefined
        collectedSoFar = Number(parts[3]) || 0
      }
    }

    const remainingPosts = maxPosts - collectedSoFar
    const pageBatchSize = Math.min(POSTS_PER_PAGE, remainingPosts)

    const { posts, after } = await fetchSubredditPosts(
      accessToken,
      subreddit,
      sort,
      timeFilter,
      pageBatchSize,
      afterToken
    )

    const documents: ExternalDocument[] = posts.map((post) => ({
      externalId: post.id,
      title: post.title,
      content: '',
      contentDeferred: true,
      mimeType: 'text/plain',
      sourceUrl: `https://www.reddit.com${post.permalink}`,
      contentHash: `reddit:${post.id}:${post.created_utc}`,
      metadata: {
        author: post.author,
        score: post.score,
        commentCount: post.num_comments,
        flair: post.link_flair_text ?? undefined,
        postDate: new Date(post.created_utc * 1000).toISOString(),
        subreddit: post.subreddit,
      },
    }))

    const totalCollected = collectedSoFar + documents.length
    const hasMore = after !== null && totalCollected < maxPosts

    return {
      documents,
      hasMore,
      nextCursor: hasMore ? `after:${after}:collected:${totalCollected}` : undefined,
    }
  },

  getDocument: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    externalId: string
  ): Promise<ExternalDocument | null> => {
    const subreddit = (sourceConfig.subreddit as string)?.trim().replace(/^r\//, '')
    if (!subreddit) return null

    try {
      const data = (await redditApiGet(`/r/${subreddit}/comments/${externalId}`, accessToken, {
        limit: String(COMMENTS_PER_POST),
        depth: '1',
        sort: 'top',
      })) as RedditListing[]

      if (!Array.isArray(data) || data.length === 0) return null

      const postListing = data[0]
      const postChildren = postListing.data.children as RedditPost[]
      if (postChildren.length === 0) return null

      const post = postChildren[0].data
      const comments =
        data.length >= 2 ? extractComments(data[1] as RedditListing, COMMENTS_PER_POST) : []
      const content = await formatPostContent(accessToken, post, COMMENTS_PER_POST, comments)

      return {
        externalId: post.id,
        title: post.title,
        content,
        contentDeferred: false,
        mimeType: 'text/plain',
        sourceUrl: `https://www.reddit.com${post.permalink}`,
        contentHash: `reddit:${post.id}:${post.created_utc}`,
        metadata: {
          author: post.author,
          score: post.score,
          commentCount: post.num_comments,
          flair: post.link_flair_text ?? undefined,
          postDate: new Date(post.created_utc * 1000).toISOString(),
          subreddit: post.subreddit,
        },
      }
    } catch (error) {
      logger.warn('Failed to get Reddit post document', {
        externalId,
        error: toError(error).message,
      })
      return null
    }
  },

  validateConfig: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>
  ): Promise<{ valid: boolean; error?: string }> => {
    const subredditInput = (sourceConfig.subreddit as string | undefined)
      ?.trim()
      .replace(/^r\//, '')
    const maxPosts = sourceConfig.maxPosts as string | undefined

    if (!subredditInput) {
      return { valid: false, error: 'Subreddit is required' }
    }

    if (maxPosts && (Number.isNaN(Number(maxPosts)) || Number(maxPosts) <= 0)) {
      return { valid: false, error: 'Max posts must be a positive number' }
    }

    try {
      const data = (await redditApiGet(
        `/r/${subredditInput}/about`,
        accessToken,
        {},
        VALIDATE_RETRY_OPTIONS
      )) as { kind: string; data: { display_name: string; subreddit_type?: string } }

      if (data.data?.subreddit_type === 'private') {
        return { valid: false, error: `Subreddit r/${subredditInput} is private` }
      }

      return { valid: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to validate configuration'
      if (message.includes('404') || message.includes('403')) {
        return {
          valid: false,
          error: `Subreddit r/${subredditInput} not found or is not accessible`,
        }
      }
      return { valid: false, error: message }
    }
  },

  tagDefinitions: [
    { id: 'author', displayName: 'Author', fieldType: 'text' },
    { id: 'score', displayName: 'Score', fieldType: 'number' },
    { id: 'commentCount', displayName: 'Comment Count', fieldType: 'number' },
    { id: 'flair', displayName: 'Flair', fieldType: 'text' },
    { id: 'postDate', displayName: 'Post Date', fieldType: 'date' },
  ],

  mapTags: (metadata: Record<string, unknown>): Record<string, unknown> => {
    const result: Record<string, unknown> = {}

    if (typeof metadata.author === 'string') {
      result.author = metadata.author
    }

    if (typeof metadata.score === 'number') {
      result.score = metadata.score
    }

    if (typeof metadata.commentCount === 'number') {
      result.commentCount = metadata.commentCount
    }

    if (typeof metadata.flair === 'string') {
      result.flair = metadata.flair
    }

    const postDate = parseTagDate(metadata.postDate)
    if (postDate) {
      result.postDate = postDate
    }

    return result
  },
}
