import { createLogger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import { xIcon } from '@/components/icons'
import { fetchWithRetry, VALIDATE_RETRY_OPTIONS } from '@/lib/knowledge/documents/utils'
import type { ConnectorConfig, ExternalDocument, ExternalDocumentList } from '@/connectors/types'
import { parseMultiValue, parseTagDate } from '@/connectors/utils'

const logger = createLogger('XConnector')

const X_API_BASE = 'https://api.x.com/2'
const DEFAULT_MAX_POSTS = 200
/** Max page size accepted by the timeline, mentions, bookmarks, and likes endpoints. */
const POSTS_PER_PAGE = 100
/**
 * Minimum `max_results` accepted by the user-tweets, mentions, and liked-tweets
 * endpoints. The bookmarks endpoint is the sole exception and accepts a minimum of 1.
 */
const MIN_PAGE_SIZE = 5
/**
 * `edit_history_tweet_ids` is requested explicitly (it is not a default field) so the
 * content hash can key on edit-history length and detect edits.
 */
const TWEET_FIELDS = 'created_at,public_metrics,text,edit_history_tweet_ids'

/**
 * Sync mode determines which timeline the connector reads.
 * - `me`: the authenticated user's own posts (GET /2/users/:id/tweets)
 * - `user`: another account's posts by username (GET /2/users/:id/tweets)
 * - `mentions`: posts mentioning the authenticated user (GET /2/users/:id/mentions)
 * - `bookmarks`: the authenticated user's bookmarks (GET /2/users/:id/bookmarks)
 * - `likes`: posts the authenticated user has liked (GET /2/users/:id/liked_tweets)
 */
type SyncMode = 'me' | 'user' | 'mentions' | 'bookmarks' | 'likes'

/** Modes whose endpoint supports the `exclude=retweets,replies` parameter. */
const EXCLUDE_CAPABLE_MODES: ReadonlySet<SyncMode> = new Set<SyncMode>(['me', 'user'])
/** Modes whose endpoint supports the `start_time` / `end_time` parameters. */
const DATE_RANGE_CAPABLE_MODES: ReadonlySet<SyncMode> = new Set<SyncMode>([
  'me',
  'user',
  'mentions',
])

interface XPublicMetrics {
  retweet_count?: number
  reply_count?: number
  like_count?: number
  quote_count?: number
}

interface XTweet {
  id: string
  text: string
  created_at?: string
  author_id?: string
  public_metrics?: XPublicMetrics
  edit_history_tweet_ids?: string[]
}

interface XUser {
  id: string
  name?: string
  username?: string
}

interface XListResponse {
  data?: XTweet[]
  includes?: { users?: XUser[] }
  meta?: { next_token?: string; result_count?: number }
  errors?: Array<{ detail?: string; title?: string }>
}

interface XSingleResponse {
  data?: XTweet
  includes?: { users?: XUser[] }
  errors?: Array<{ detail?: string; title?: string }>
}

/**
 * Resolves the configured sync mode, defaulting to the authenticated user's
 * own posts.
 */
function resolveSyncMode(sourceConfig: Record<string, unknown>): SyncMode {
  const mode = sourceConfig.syncMode
  if (mode === 'user' || mode === 'mentions' || mode === 'bookmarks' || mode === 'likes') {
    return mode
  }
  return 'me'
}

/**
 * Reads a boolean toggle from a dropdown config field that stores 'true' / 'false'
 * strings. Falls back to `defaultValue` when unset or unrecognized.
 */
function readBooleanOption(value: unknown, defaultValue: boolean): boolean {
  if (value === 'true' || value === true) return true
  if (value === 'false' || value === false) return false
  return defaultValue
}

/**
 * Parses the configured usernames into a normalized, deduplicated handle list.
 *
 * Handles are lowercased and stripped of a leading `@` before deduplication so
 * that `jack`, `@jack`, and `Jack` collapse to a single entry — avoiding a
 * duplicate user-id lookup and a redundant `userIndex` slot in the packed
 * pagination cursor. Both `validateConfig` and `listDocuments` call this so the
 * cursor's `userIndex` stays aligned to the same array across pages.
 */
function parseUsernames(value: unknown): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of parseMultiValue(value)) {
    const handle = raw.replace(/^@/, '').toLowerCase()
    if (!handle || seen.has(handle)) continue
    seen.add(handle)
    out.push(handle)
  }
  return out
}

/**
 * Reads and trims a string config field, returning undefined when blank.
 */
function readTrimmed(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

/**
 * Performs an authenticated GET against the X API v2 and returns the parsed JSON.
 */
async function xApiGet(
  path: string,
  accessToken: string,
  params?: Record<string, string>,
  retryOptions?: Parameters<typeof fetchWithRetry>[2]
): Promise<unknown> {
  const queryParams = params ? `?${new URLSearchParams(params).toString()}` : ''
  const url = `${X_API_BASE}${path}${queryParams}`

  const response = await fetchWithRetry(
    url,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    },
    retryOptions
  )

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`X API HTTP error: ${response.status} ${response.statusText} ${body}`.trim())
  }

  return response.json()
}

/**
 * Resolves the authenticated user's numeric ID via GET /2/users/me.
 */
async function resolveMyUserId(
  accessToken: string,
  retryOptions?: Parameters<typeof fetchWithRetry>[2]
): Promise<string> {
  const data = (await xApiGet('/users/me', accessToken, undefined, retryOptions)) as {
    data?: { id?: string }
  }
  const id = data.data?.id
  if (!id) throw new Error('Failed to resolve authenticated user ID')
  return id
}

/**
 * Resolves a public username to its numeric user ID via
 * GET /2/users/by/username/:username.
 */
async function resolveUsernameId(
  accessToken: string,
  username: string,
  retryOptions?: Parameters<typeof fetchWithRetry>[2]
): Promise<string> {
  const handle = username.trim().replace(/^@/, '')
  const data = (await xApiGet(
    `/users/by/username/${encodeURIComponent(handle)}`,
    accessToken,
    undefined,
    retryOptions
  )) as { data?: { id?: string }; errors?: Array<{ detail?: string }> }
  const id = data.data?.id
  if (!id) {
    throw new Error(data.errors?.[0]?.detail || `User @${handle} not found`)
  }
  return id
}

/**
 * Builds a deterministic, metadata-based content hash for a tweet.
 *
 * Tweets are immutable outside the brief post-publish edit window; an edit
 * appends a new ID to `edit_history_tweet_ids`. We therefore key the hash on
 * the edit-history length when present (so edits are detected as changes), and
 * fall back to `created_at` when the field is absent.
 */
function tweetContentHash(tweet: XTweet): string {
  const historyLength = Array.isArray(tweet.edit_history_tweet_ids)
    ? tweet.edit_history_tweet_ids.length
    : undefined
  const changeIndicator = historyLength ?? tweet.created_at ?? ''
  return `x:${tweet.id}:${changeIndicator}`
}

/**
 * Builds the canonical source URL for a tweet. When the author's username is
 * unknown, falls back to the username-agnostic permalink which X redirects.
 */
function tweetSourceUrl(tweetId: string, username?: string): string {
  if (username) return `https://x.com/${username}/status/${tweetId}`
  return `https://x.com/i/web/status/${tweetId}`
}

/**
 * Derives a short title from the tweet text (first line, truncated).
 */
function tweetTitle(text: string): string {
  const firstLine = text.split('\n')[0].trim()
  if (!firstLine) return 'Tweet'
  return firstLine.length > 80 ? `${firstLine.slice(0, 77)}...` : firstLine
}

/**
 * Converts a tweet (and its resolved author) into an ExternalDocument with
 * inline content — the list API returns full text, so no deferral is needed.
 *
 * The author is the actual tweet author resolved from the `author_id` expansion,
 * not the credential owner — important for bookmarks and likes, where most posts
 * belong to other accounts.
 */
function tweetToDocument(tweet: XTweet, author?: XUser): ExternalDocument {
  const metrics = tweet.public_metrics ?? {}
  return {
    externalId: tweet.id,
    title: tweetTitle(tweet.text),
    content: tweet.text,
    mimeType: 'text/plain',
    sourceUrl: tweetSourceUrl(tweet.id, author?.username),
    contentHash: tweetContentHash(tweet),
    metadata: {
      author: author?.username ?? author?.name ?? undefined,
      authorName: author?.name ?? undefined,
      createdAt: tweet.created_at ?? undefined,
      likeCount: metrics.like_count ?? 0,
      retweetCount: metrics.retweet_count ?? 0,
      replyCount: metrics.reply_count ?? 0,
      quoteCount: metrics.quote_count ?? 0,
    },
  }
}

/**
 * Maps tweets from a list response to documents, joining each tweet to its
 * author via the `includes.users` expansion (matched on `author_id`).
 */
function mapTweets(response: XListResponse): ExternalDocument[] {
  const usersById = new Map<string, XUser>()
  for (const user of response.includes?.users ?? []) {
    usersById.set(user.id, user)
  }
  const tweets = response.data ?? []
  return tweets.map((tweet) => tweetToDocument(tweet, usersById.get(tweet.author_id ?? '')))
}

/**
 * Returns the API path for a given mode and resolved user ID.
 */
function listPathForMode(mode: SyncMode, userId: string): string {
  switch (mode) {
    case 'bookmarks':
      return `/users/${userId}/bookmarks`
    case 'likes':
      return `/users/${userId}/liked_tweets`
    case 'mentions':
      return `/users/${userId}/mentions`
    default:
      return `/users/${userId}/tweets`
  }
}

/**
 * Builds the query string for the active listing endpoint. `pageSize` is the
 * per-request `max_results`, already clamped to the endpoint's valid range and
 * to any remaining cap. `exclude` and date-range params are only attached for
 * the modes whose endpoint supports them.
 */
function buildListParams(
  sourceConfig: Record<string, unknown>,
  mode: SyncMode,
  pageSize: number,
  cursor?: string
): Record<string, string> {
  const params: Record<string, string> = {
    max_results: String(pageSize),
    'tweet.fields': TWEET_FIELDS,
    expansions: 'author_id',
    'user.fields': 'name,username',
  }

  if (EXCLUDE_CAPABLE_MODES.has(mode)) {
    const includeReplies = readBooleanOption(sourceConfig.includeReplies, false)
    const includeRetweets = readBooleanOption(sourceConfig.includeRetweets, false)
    const exclude: string[] = []
    if (!includeRetweets) exclude.push('retweets')
    if (!includeReplies) exclude.push('replies')
    if (exclude.length > 0) params.exclude = exclude.join(',')
  }

  if (DATE_RANGE_CAPABLE_MODES.has(mode)) {
    const startTime = readTrimmed(sourceConfig.startTime)
    const endTime = readTrimmed(sourceConfig.endTime)
    if (startTime) params.start_time = startTime
    if (endTime) params.end_time = endTime
  }

  if (cursor) params.pagination_token = cursor
  return params
}

/**
 * Clamps the requested page size to the endpoint's valid range and to the number
 * of posts still needed under the cap. The user-tweets, mentions, and liked-tweets
 * endpoints require `max_results` ≥ 5; only bookmarks accepts ≥ 1. We always request
 * at least the endpoint minimum (over-fetch on the final page is trimmed afterward).
 */
function resolvePageSize(mode: SyncMode, remaining: number): number {
  const floor = mode === 'bookmarks' ? 1 : MIN_PAGE_SIZE
  if (remaining <= 0) return POSTS_PER_PAGE
  return Math.max(floor, Math.min(POSTS_PER_PAGE, remaining))
}

export const xConnector: ConnectorConfig = {
  id: 'x',
  name: 'X',
  description: 'Sync posts from X (formerly Twitter) into your knowledge base',
  version: '1.0.0',
  icon: xIcon,

  auth: {
    mode: 'oauth',
    provider: 'x',
    requiredScopes: ['tweet.read', 'users.read', 'bookmark.read', 'like.read', 'offline.access'],
  },

  configFields: [
    {
      id: 'syncMode',
      title: 'Sync Mode',
      type: 'dropdown',
      required: false,
      description: 'Which posts to sync into the knowledge base',
      options: [
        { label: 'My posts', id: 'me' },
        { label: 'Another user', id: 'user' },
        { label: 'My mentions', id: 'mentions' },
        { label: 'My bookmarks', id: 'bookmarks' },
        { label: 'My likes', id: 'likes' },
      ],
    },
    {
      id: 'username',
      title: 'Username(s)',
      type: 'short-input',
      required: false,
      multi: true,
      placeholder: 'e.g. jack, xdevelopers (required for "Another user")',
      description:
        'One or more X usernames to sync posts from (comma-separated). Only used when Sync Mode is "Another user".',
    },
    {
      id: 'includeReplies',
      title: 'Include Replies',
      type: 'dropdown',
      required: false,
      options: [
        { label: 'Exclude replies', id: 'false' },
        { label: 'Include replies', id: 'true' },
      ],
      description: 'Whether to include reply posts. Applies to "My posts" and "Another user".',
    },
    {
      id: 'includeRetweets',
      title: 'Include Retweets',
      type: 'dropdown',
      required: false,
      options: [
        { label: 'Exclude retweets', id: 'false' },
        { label: 'Include retweets', id: 'true' },
      ],
      description: 'Whether to include retweets. Applies to "My posts" and "Another user".',
    },
    {
      id: 'startTime',
      title: 'Start Time',
      type: 'short-input',
      required: false,
      mode: 'advanced',
      placeholder: 'e.g. 2024-01-01T00:00:00Z',
      description:
        'Oldest post time (ISO 8601 UTC). Applies to posts and mentions; ignored for bookmarks and likes.',
    },
    {
      id: 'endTime',
      title: 'End Time',
      type: 'short-input',
      required: false,
      mode: 'advanced',
      placeholder: 'e.g. 2024-12-31T23:59:59Z',
      description:
        'Newest post time (ISO 8601 UTC). Applies to posts and mentions; ignored for bookmarks and likes.',
    },
    {
      id: 'maxPosts',
      title: 'Max Posts',
      type: 'short-input',
      required: false,
      placeholder: `e.g. 100 (default: ${DEFAULT_MAX_POSTS})`,
      description:
        'Maximum number of posts to sync (across all configured users). Posts beyond this limit are not deleted from the knowledge base; X also only exposes a limited recent window (≈3,200 timeline posts, ≈800 bookmarks), so posts that age out of that window are removed on the next sync.',
    },
  ],

  listDocuments: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    cursor?: string,
    syncContext?: Record<string, unknown>
  ): Promise<ExternalDocumentList> => {
    const mode = resolveSyncMode(sourceConfig)
    const maxPosts = sourceConfig.maxPosts ? Number(sourceConfig.maxPosts) : DEFAULT_MAX_POSTS

    const collectedSoFar = (syncContext?.collected as number) ?? 0
    if (maxPosts > 0 && collectedSoFar >= maxPosts) {
      return { documents: [], hasMore: false }
    }

    // For the multi-username "user" mode, walk one username per cursor cycle. The
    // cursor packs the username index and that user's pagination token; the shared
    // cap is enforced across all users via syncContext.collected.
    const usernames = mode === 'user' ? parseUsernames(sourceConfig.username) : []
    if (mode === 'user' && usernames.length === 0) {
      throw new Error('Username is required when Sync Mode is "Another user"')
    }

    let userIndex = 0
    let pageToken = cursor
    if (mode === 'user' && cursor) {
      const sep = cursor.indexOf(':')
      if (sep >= 0) {
        userIndex = Number(cursor.slice(0, sep)) || 0
        const token = cursor.slice(sep + 1)
        pageToken = token.length > 0 ? token : undefined
      }
    }

    // Resolve the target user ID. For `user` mode it depends on the current index
    // (resolved per page, cheap); for self-modes it is cached on syncContext.
    let userId: string
    if (mode === 'user') {
      userId = await resolveUsernameId(accessToken, usernames[userIndex])
    } else {
      userId = (syncContext?.userId as string | undefined) ?? (await resolveMyUserId(accessToken))
      if (syncContext) syncContext.userId = userId
    }

    const remaining = maxPosts > 0 ? maxPosts - collectedSoFar : 0
    const pageSize = resolvePageSize(mode, remaining)
    const path = listPathForMode(mode, userId)
    const params = buildListParams(sourceConfig, mode, pageSize, pageToken)

    logger.info('Syncing X posts', { mode, userId, userIndex, maxPosts })

    const response = (await xApiGet(path, accessToken, params)) as XListResponse
    if (response.errors?.length && !response.data) {
      throw new Error(response.errors[0]?.detail || response.errors[0]?.title || 'X API error')
    }

    let documents = mapTweets(response)

    if (maxPosts > 0 && collectedSoFar + documents.length > maxPosts) {
      documents = documents.slice(0, maxPosts - collectedSoFar)
    }
    const newCollected = collectedSoFar + documents.length
    if (syncContext) syncContext.collected = newCollected

    const capReached = maxPosts > 0 && newCollected >= maxPosts
    const nextToken = response.meta?.next_token

    // Advance pagination: continue the current user's pages, else move to the next
    // username (user mode), else stop.
    if (capReached) {
      // We stopped before exhausting the source, so the listing is incomplete:
      // older previously-synced posts may still exist beyond the `maxPosts` cap.
      // Flag the sync as capped so the engine skips deletion reconciliation and
      // does not soft-delete posts that simply fell outside this run's window.
      // A forced full sync bypasses this guard and reconciles normally.
      if (syncContext) syncContext.listingCapped = true
      return { documents, hasMore: false }
    }

    if (mode === 'user') {
      if (nextToken) {
        return { documents, nextCursor: `${userIndex}:${nextToken}`, hasMore: true }
      }
      const nextUserIndex = userIndex + 1
      if (nextUserIndex < usernames.length) {
        return { documents, nextCursor: `${nextUserIndex}:`, hasMore: true }
      }
      return { documents, hasMore: false }
    }

    return {
      documents,
      nextCursor: nextToken ?? undefined,
      hasMore: Boolean(nextToken),
    }
  },

  getDocument: async (
    accessToken: string,
    _sourceConfig: Record<string, unknown>,
    externalId: string
  ): Promise<ExternalDocument | null> => {
    try {
      const response = (await xApiGet(`/tweets/${encodeURIComponent(externalId)}`, accessToken, {
        'tweet.fields': TWEET_FIELDS,
        expansions: 'author_id',
        'user.fields': 'name,username',
      })) as XSingleResponse

      const tweet = response.data
      if (!tweet) return null

      const author = response.includes?.users?.find((u) => u.id === tweet.author_id)
      return tweetToDocument(tweet, author)
    } catch (error) {
      logger.warn('Failed to get X tweet document', {
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
    const mode = resolveSyncMode(sourceConfig)
    const usernames = mode === 'user' ? parseUsernames(sourceConfig.username) : []
    const maxPosts = sourceConfig.maxPosts as string | undefined

    if (mode === 'user' && usernames.length === 0) {
      return { valid: false, error: 'Username is required when Sync Mode is "Another user"' }
    }

    if (maxPosts && (Number.isNaN(Number(maxPosts)) || Number(maxPosts) <= 0)) {
      return { valid: false, error: 'Max posts must be a positive number' }
    }

    const startTime = readTrimmed(sourceConfig.startTime)
    if (startTime && Number.isNaN(new Date(startTime).getTime())) {
      return { valid: false, error: 'Start Time must be a valid ISO 8601 timestamp' }
    }
    const endTime = readTrimmed(sourceConfig.endTime)
    if (endTime && Number.isNaN(new Date(endTime).getTime())) {
      return { valid: false, error: 'End Time must be a valid ISO 8601 timestamp' }
    }

    try {
      await resolveMyUserId(accessToken, VALIDATE_RETRY_OPTIONS)

      if (mode === 'user') {
        for (const username of usernames) {
          await resolveUsernameId(accessToken, username, VALIDATE_RETRY_OPTIONS)
        }
      }

      return { valid: true }
    } catch (error) {
      return { valid: false, error: getErrorMessage(error, 'Failed to validate configuration') }
    }
  },

  tagDefinitions: [
    { id: 'author', displayName: 'Author', fieldType: 'text' },
    { id: 'createdAt', displayName: 'Created Date', fieldType: 'date' },
    { id: 'likeCount', displayName: 'Like Count', fieldType: 'number' },
    { id: 'retweetCount', displayName: 'Retweet Count', fieldType: 'number' },
  ],

  mapTags: (metadata: Record<string, unknown>): Record<string, unknown> => {
    const result: Record<string, unknown> = {}

    if (typeof metadata.author === 'string') {
      result.author = metadata.author
    }

    const createdAt = parseTagDate(metadata.createdAt)
    if (createdAt) {
      result.createdAt = createdAt
    }

    if (metadata.likeCount != null) {
      const num = Number(metadata.likeCount)
      if (!Number.isNaN(num)) result.likeCount = num
    }

    if (metadata.retweetCount != null) {
      const num = Number(metadata.retweetCount)
      if (!Number.isNaN(num)) result.retweetCount = num
    }

    return result
  },
}
