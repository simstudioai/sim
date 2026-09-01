import { createLogger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import { fetchWithRetry, VALIDATE_RETRY_OPTIONS } from '@/lib/knowledge/documents/utils'
import { DEFAULT_MAX_POSTS, redditConnectorMeta } from '@/connectors/reddit/meta'
import type { ConnectorConfig, ExternalDocument, ExternalDocumentList } from '@/connectors/types'
import { parseTagDate } from '@/connectors/utils'
import { REDDIT_USER_AGENT } from '@/tools/reddit/constants'

const logger = createLogger('RedditConnector')

const REDDIT_API_BASE = 'https://oauth.reddit.com'

/** Max `limit` accepted by Reddit listing endpoints. */
const POSTS_PER_PAGE = 100

/** Top-level comments appended to each post's indexed content. */
const COMMENTS_PER_POST = 15

/**
 * Reddit listings stop paginating after ~1000 items regardless of `after`, so a
 * listing that ends exactly at the ceiling is truncated by Reddit rather than
 * exhausted and must not drive deletion reconciliation.
 */
const REDDIT_LISTING_DEPTH_LIMIT = 1000

const VALID_SORTS = new Set(['hot', 'new', 'top', 'rising'])
const VALID_TIME_FILTERS = new Set(['hour', 'day', 'week', 'month', 'year', 'all'])

/**
 * Reddit restricts subreddit names to at most 21 letters, digits and
 * underscores. The lower bound is 2 rather than the 3 the creation form
 * enforces today, so legacy two-character subreddits (r/de) stay syncable.
 */
const SUBREDDIT_PATTERN = /^[A-Za-z0-9_]{2,21}$/

/** Body text Reddit substitutes for content removed by a mod or deleted by its author. */
const REMOVED_PLACEHOLDERS = new Set(['[removed]', '[deleted]'])

interface RedditPost {
  kind: string
  data: {
    id: string
    title: string
    /** Raw markdown body. Preferred over `selftext_html` so no HTML stripping is needed. */
    selftext: string
    author: string
    score: number
    num_comments: number
    created_utc: number
    /**
     * Unix seconds when the post was last edited, `false` when never edited, and
     * `true` on posts edited before Reddit started recording the timestamp.
     */
    edited?: number | boolean
    permalink: string
    url: string
    link_flair_text?: string
    subreddit: string
    is_self: boolean
  }
}

interface RedditComment {
  kind: string
  data: {
    author: string
    body: string
    score: number
  }
}

/** `kind: 'more'` stub standing in for comments the tree endpoint did not expand. */
interface RedditMore {
  kind: string
  data: {
    count?: number
  }
}

interface RedditListing {
  kind: string
  data: {
    children: (RedditPost | RedditComment | RedditMore)[]
    after: string | null
  }
}

class RedditApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
    this.name = 'RedditApiError'
  }
}

/**
 * Makes an authenticated request to the Reddit API.
 *
 * `raw_json=1` is always sent: without it Reddit HTML-escapes `selftext` and
 * comment `body` (`&amp;`, `&lt;`, `&#39;`), which would be indexed verbatim.
 */
async function redditApiGet(
  path: string,
  accessToken: string,
  params?: Record<string, string>,
  retryOptions?: Parameters<typeof fetchWithRetry>[2]
): Promise<unknown> {
  const queryParams = new URLSearchParams({ ...params, raw_json: '1' })
  const url = `${REDDIT_API_BASE}${path}?${queryParams.toString()}`

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
    throw new RedditApiError(
      `Reddit API HTTP error: ${response.status} ${response.statusText}`,
      response.status
    )
  }

  return response.json()
}

/**
 * Normalizes and validates a user-supplied subreddit name.
 *
 * The value is interpolated into the API path, so anything outside Reddit's own
 * name charset is rejected rather than escaped — a slash would otherwise
 * redirect the request to a different endpoint.
 */
function normalizeSubreddit(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const name = value.trim().replace(/^\/+/, '').replace(/^r\//i, '').replace(/\/+$/, '')
  return SUBREDDIT_PATTERN.test(name) ? name : null
}

/**
 * Resolves sort and time filter from source config, rejecting values outside the
 * documented sets so neither can reshape the request path or query.
 */
function resolveSortConfig(sourceConfig: Record<string, unknown>): {
  sort: string
  timeFilter: string
} {
  const rawSort = typeof sourceConfig.sort === 'string' ? sourceConfig.sort : ''
  const rawTimeFilter = typeof sourceConfig.timeFilter === 'string' ? sourceConfig.timeFilter : ''
  return {
    sort: VALID_SORTS.has(rawSort) ? rawSort : 'hot',
    timeFilter: VALID_TIME_FILTERS.has(rawTimeFilter) ? rawTimeFilter : 'week',
  }
}

/** Resolves the post cap, clamped to Reddit's listing depth ceiling. */
function resolveMaxPosts(sourceConfig: Record<string, unknown>): number {
  const raw = sourceConfig.maxPosts ? Number(sourceConfig.maxPosts) : DEFAULT_MAX_POSTS
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_MAX_POSTS
  return Math.min(Math.floor(raw), REDDIT_LISTING_DEPTH_LIMIT)
}

/** Strips Reddit's removal placeholders so they are never indexed as content. */
function cleanBody(text: string | undefined): string {
  const trimmed = text?.trim() ?? ''
  return REMOVED_PLACEHOLDERS.has(trimmed) ? '' : trimmed
}

/**
 * Extracts formatted comment strings from a Reddit comment listing.
 *
 * `kind: 'more'` children are stubs the tree endpoint did not expand (they need
 * a separate `/api/morechildren` call). They are deliberately not expanded, so
 * their hidden count is returned and surfaced in the document instead of being
 * dropped silently.
 */
function extractComments(
  commentListing: RedditListing,
  maxComments: number
): { comments: string[]; omitted: number } {
  const comments: string[] = []
  let omitted = 0

  for (const child of commentListing.data.children) {
    if (child.kind === 'more') {
      omitted += (child as RedditMore).data.count ?? 0
      continue
    }
    if (child.kind !== 't1') continue
    const comment = child as RedditComment
    const body = cleanBody(comment.data.body)
    if (!body || comment.data.author === 'AutoModerator') continue
    if (comments.length >= maxComments) {
      omitted += 1
      continue
    }
    comments.push(`[${comment.data.author} | score: ${comment.data.score}]: ${body}`)
  }

  return { comments, omitted }
}

/**
 * Formats a Reddit post with its comments into a document content string.
 */
function formatPostContent(
  post: RedditPost['data'],
  comments: string[],
  omittedComments: number
): string {
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

  const body = cleanBody(post.selftext)
  if (body) {
    lines.push(body)
    lines.push('')
  }

  if (comments.length > 0) {
    lines.push('---')
    lines.push(`Top Comments (${comments.length}):`)
    lines.push('')
    for (const comment of comments) {
      lines.push(comment)
      lines.push('')
    }
    if (omittedComments > 0) {
      lines.push(`(${omittedComments} further comments not indexed)`)
    }
  }

  return lines.join('\n').trim()
}

/**
 * Change-detection hash for a post.
 *
 * Derived only from fields present in the listing so `listDocuments` and
 * `getDocument` produce the same value. `score` is deliberately excluded —
 * Reddit fuzzes vote counts, so including it would re-index every post on every
 * sync. `num_comments` is included because the indexed content embeds comments.
 */
function postContentHash(post: RedditPost['data']): string {
  const revision = typeof post.edited === 'number' ? post.edited : post.created_utc
  return `reddit:${post.id}:${revision}:${post.num_comments}`
}

/**
 * Builds the lightweight listing stub for a post. Shared by `listDocuments` and
 * `getDocument` so `contentHash` and `metadata` can never drift between them.
 */
function postToStub(post: RedditPost['data']): ExternalDocument {
  return {
    externalId: post.id,
    title: post.title || 'Untitled',
    content: '',
    contentDeferred: true,
    mimeType: 'text/plain',
    sourceUrl: `https://www.reddit.com${post.permalink}`,
    contentHash: postContentHash(post),
    metadata: {
      author: post.author,
      score: post.score,
      commentCount: post.num_comments,
      flair: post.link_flair_text ?? undefined,
      postDate: new Date(post.created_utc * 1000).toISOString(),
      subreddit: post.subreddit,
    },
  }
}

/**
 * Fetches posts from a subreddit listing endpoint, requesting further pages
 * until `maxPosts` posts are collected or Reddit stops handing out cursors.
 */
async function fetchSubredditPosts(
  accessToken: string,
  subreddit: string,
  sort: string,
  timeFilter: string,
  maxPosts: number,
  alreadyCollected: number,
  afterCursor?: string
): Promise<{ posts: RedditPost['data'][]; after: string | null }> {
  const allPosts: RedditPost['data'][] = []
  let after: string | null = afterCursor ?? null

  while (allPosts.length < maxPosts) {
    const limit = Math.min(POSTS_PER_PAGE, maxPosts - allPosts.length)
    const params: Record<string, string> = {
      limit: String(limit),
      count: String(alreadyCollected + allPosts.length),
    }

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

    const children = data.data.children
    if (children.length === 0) {
      after = null
      break
    }

    for (const child of children) {
      if (child.kind === 't3') {
        allPosts.push((child as RedditPost).data)
      }
    }

    after = data.data.after
    if (!after) break
  }

  return { posts: allPosts, after }
}

export const redditConnector: ConnectorConfig = {
  ...redditConnectorMeta,

  listDocuments: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    cursor?: string,
    syncContext?: Record<string, unknown>
  ): Promise<ExternalDocumentList> => {
    const subreddit = normalizeSubreddit(sourceConfig.subreddit)
    if (!subreddit) {
      throw new Error('A valid subreddit name is required')
    }

    const { sort, timeFilter } = resolveSortConfig(sourceConfig)
    const maxPosts = resolveMaxPosts(sourceConfig)

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
      collectedSoFar,
      afterToken
    )

    const documents: ExternalDocument[] = posts.map(postToStub)

    const totalCollected = collectedSoFar + documents.length
    const sourceHasMore = after !== null
    const hitCap = totalCollected >= maxPosts
    const hasMore = !hitCap && sourceHasMore

    /**
     * The sync engine hard-deletes every stored document absent from a full
     * listing, so it must be told whenever this listing is incomplete:
     * - the `maxPosts` cap stopped us while Reddit still had posts to give
     * - Reddit's own ~1000-item listing ceiling ended pagination early
     *
     * A cap that lands exactly on an exhausted listing is NOT flagged: that
     * listing is complete, and flagging it would strand removed posts in the
     * knowledge base forever. Neither `sort` nor `timeFilter` is flagged —
     * those are intentional scope filters, not truncation.
     */
    if (syncContext) {
      syncContext.totalDocsFetched = totalCollected
      const truncatedByCap = hitCap && sourceHasMore
      const truncatedByDepthCeiling = !sourceHasMore && totalCollected >= REDDIT_LISTING_DEPTH_LIMIT
      if (truncatedByCap || truncatedByDepthCeiling) {
        logger.info('Reddit listing truncated; deletion reconciliation suppressed', {
          subreddit,
          totalCollected,
          maxPosts,
          truncatedByCap,
          truncatedByDepthCeiling,
        })
        syncContext.listingCapped = true
      }
    }

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
    const subreddit = normalizeSubreddit(sourceConfig.subreddit)
    if (!subreddit) return null

    try {
      /**
       * `/r/{sub}/comments/{id}` returns a two-element array: the first listing
       * holds the post itself, the second the comment tree. `depth=1` keeps the
       * tree to top-level comments.
       */
      const data = (await redditApiGet(`/r/${subreddit}/comments/${externalId}`, accessToken, {
        limit: String(COMMENTS_PER_POST),
        depth: '1',
        sort: 'top',
      })) as RedditListing[]

      if (!Array.isArray(data) || data.length === 0) return null

      const postChildren = data[0]?.data?.children ?? []
      const postChild = postChildren.find((child) => child.kind === 't3') as RedditPost | undefined
      if (!postChild) return null

      const post = postChild.data
      const { comments, omitted } =
        data.length >= 2
          ? extractComments(data[1], COMMENTS_PER_POST)
          : { comments: [], omitted: 0 }

      return {
        ...postToStub(post),
        content: formatPostContent(post, comments, omitted),
        contentDeferred: false,
      }
    } catch (error) {
      /**
       * Only a deleted post (404) resolves to `null`. Everything else — a 403 on
       * a subreddit that went private, a 5xx, a network failure — is rethrown so
       * the sync engine records a visible failed document instead of silently
       * dropping the post from the run.
       */
      if (error instanceof RedditApiError && error.status === 404) {
        return null
      }
      logger.warn('Failed to get Reddit post document', {
        externalId,
        error: toError(error).message,
      })
      throw error
    }
  },

  validateConfig: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>
  ): Promise<{ valid: boolean; error?: string }> => {
    const subreddit = normalizeSubreddit(sourceConfig.subreddit)
    const maxPosts = sourceConfig.maxPosts as string | undefined

    if (!subreddit) {
      return {
        valid: false,
        error: 'Subreddit is required and may only contain letters, digits and underscores',
      }
    }

    if (maxPosts && (Number.isNaN(Number(maxPosts)) || Number(maxPosts) <= 0)) {
      return { valid: false, error: 'Max posts must be a positive number' }
    }

    try {
      const data = (await redditApiGet(
        `/r/${subreddit}/about`,
        accessToken,
        undefined,
        VALIDATE_RETRY_OPTIONS
      )) as { kind: string; data: { display_name: string; subreddit_type?: string } }

      if (data.data?.subreddit_type === 'private') {
        return { valid: false, error: `Subreddit r/${subreddit} is private` }
      }

      return { valid: true }
    } catch (error) {
      if (error instanceof RedditApiError && (error.status === 404 || error.status === 403)) {
        return {
          valid: false,
          error: `Subreddit r/${subreddit} not found or is not accessible`,
        }
      }
      return { valid: false, error: getErrorMessage(error, 'Failed to validate configuration') }
    }
  },

  mapTags: (metadata: Record<string, unknown>): Record<string, unknown> => {
    const result: Record<string, unknown> = {}

    if (typeof metadata.author === 'string') {
      result.author = metadata.author
    }

    if (typeof metadata.score === 'number' && !Number.isNaN(metadata.score)) {
      result.score = metadata.score
    }

    if (typeof metadata.commentCount === 'number' && !Number.isNaN(metadata.commentCount)) {
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
