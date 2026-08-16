import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { fetchWithRetry, VALIDATE_RETRY_OPTIONS } from '@/lib/knowledge/documents/utils'
import type { ConnectorConfig, ExternalDocument, ExternalDocumentList } from '@/connectors/types'
import {
  CONNECTOR_MAX_FILE_BYTES,
  htmlToPlainText,
  joinTagArray,
  parseTagDate,
  stubOrSkipBySize,
} from '@/connectors/utils'
import { DEFAULT_MAX_POSTS, wordpressConnectorMeta } from '@/connectors/wordpress/meta'

const logger = createLogger('WordPressConnector')

const WP_API_BASE = 'https://public-api.wordpress.com/rest/v1.1/sites'

/**
 * Reduces a user-supplied site URL to the bare `$site` value the WordPress.com
 * REST API expects (a domain such as "mysite.wordpress.com", or a numeric site
 * ID). Drops the protocol, any userinfo, and any path/query/fragment — the API
 * takes the site as a single path segment, so "https://mysite.com/blog/" must
 * become "mysite.com".
 */
function normalizeSiteUrl(raw: string): string {
  return raw
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/^[^/@]*@/, '')
    .replace(/[/?#].*$/, '')
}

/** WordPress.com caps `number` at 100 per request. */
const POSTS_PER_PAGE = 100

/**
 * Post fields the connector actually reads, plus `date`.
 *
 * `date` is requested even though nothing reads it: the API builds `meta.next_page`
 * as `value=<sort column>&id=<ID>`, so it omits the handle entirely unless the
 * column it orders by is inside the projection. Ordering defaults to `date`, so
 * dropping it silently degrades every sync to offset paging — which re-numbers
 * mid-run whenever a post is published, skipping posts.
 */
const POST_FIELDS = 'ID,title,content,URL,modified,type,author,categories,tags,date'

interface WordPressPost {
  ID: number
  title: string
  content: string
  URL: string
  modified: string
  type: string
  author: {
    name: string
  }
  categories: Record<string, { name: string }>
  tags: Record<string, { name: string }>
}

interface WordPressPostsResponse {
  found: number
  posts: WordPressPost[]
  meta?: {
    next_page?: string
  }
}

interface ListCursor {
  offset: number
  pageHandle?: string
}

/**
 * Extracts category names from a WordPress categories object.
 */
function extractCategoryNames(categories: Record<string, { name: string }>): string[] {
  return Object.values(categories).map((c) => c.name)
}

/**
 * Extracts tag names from a WordPress tags object.
 */
function extractTagNames(tags: Record<string, { name: string }>): string[] {
  return Object.values(tags).map((t) => t.name)
}

/**
 * Converts a WordPress post to an ExternalDocument.
 */
function postToDocument(post: WordPressPost): ExternalDocument {
  /**
   * WordPress.com returns `title` and `content` as rendered HTML, so both go
   * through `htmlToPlainText` — a title carrying entities (`&#8217;`) or inline
   * markup would otherwise be indexed and displayed raw.
   */
  const title = htmlToPlainText(post.title ?? '')
  const plainText = htmlToPlainText(post.content ?? '')
  const fullContent = `# ${title}\n\n${plainText}`
  const contentHash = `wordpress:${post.ID}:${post.modified || ''}`
  const categories = extractCategoryNames(post.categories ?? {})
  const tags = extractTagNames(post.tags ?? {})

  const document: ExternalDocument = {
    externalId: String(post.ID),
    title: title || 'Untitled',
    content: fullContent,
    mimeType: 'text/plain',
    sourceUrl: post.URL,
    contentHash,
    metadata: {
      author: post.author?.name,
      lastModified: post.modified,
      postType: post.type,
      categories,
      tags,
    },
  }

  return stubOrSkipBySize(
    document,
    Buffer.byteLength(fullContent, 'utf8'),
    CONNECTOR_MAX_FILE_BYTES
  )
}

/**
 * Resolves the postType config value to the WordPress API type parameter.
 */
function resolvePostType(postType?: string): string {
  switch (postType) {
    case 'Posts':
      return 'post'
    case 'Pages':
      return 'page'
    default:
      return 'any'
  }
}

export const wordpressConnector: ConnectorConfig = {
  ...wordpressConnectorMeta,

  listDocuments: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    cursor?: string,
    syncContext?: Record<string, unknown>
  ): Promise<ExternalDocumentList> => {
    const rawSiteUrl = (sourceConfig.siteUrl as string)?.trim()
    if (!rawSiteUrl) {
      throw new Error('Site URL is required')
    }
    const siteUrl = normalizeSiteUrl(rawSiteUrl)

    const parsedMax = Number(sourceConfig.maxPosts)
    const maxPosts = Number.isFinite(parsedMax) && parsedMax > 0 ? parsedMax : DEFAULT_MAX_POSTS
    const type = resolvePostType(sourceConfig.postType as string | undefined)

    const parsed: ListCursor = cursor ? JSON.parse(cursor) : { offset: 0 }
    const totalDocsFetched = (syncContext?.totalDocsFetched as number) ?? 0

    const remaining = maxPosts - totalDocsFetched
    if (remaining <= 0) {
      return { documents: [], hasMore: false }
    }

    const pageSize = Math.min(POSTS_PER_PAGE, remaining)
    /**
     * `page_handle` is the API's documented (and cheapest) cursor; `offset` is the
     * fallback for the first page and for any response that omits `meta.next_page`.
     */
    const pageParam = parsed.pageHandle
      ? `page_handle=${encodeURIComponent(parsed.pageHandle)}`
      : `offset=${parsed.offset}`
    const url = `${WP_API_BASE}/${encodeURIComponent(siteUrl)}/posts?number=${pageSize}&${pageParam}&type=${type}&fields=${POST_FIELDS}`

    logger.info('Fetching WordPress posts', { siteUrl, offset: parsed.offset, type, pageSize })

    const response = await fetchWithRetry(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => '')
      throw new Error(`WordPress API error: ${response.status} ${errorText}`)
    }

    const data = (await response.json()) as WordPressPostsResponse
    const posts = data.posts || []

    const documents = posts.map(postToDocument)

    const totalFetched = totalDocsFetched + documents.length
    if (syncContext) syncContext.totalDocsFetched = totalFetched
    const hitLimit = totalFetched >= maxPosts

    const newOffset = parsed.offset + posts.length
    const moreAvailable = posts.length > 0 && newOffset < data.found
    const hasMore = !hitLimit && moreAvailable

    /**
     * An empty page while the site still reports unread posts is a truncated
     * listing, not an exhausted one, so paging stops without having seen every
     * post.
     */
    const stalledMidListing = posts.length === 0 && parsed.offset < data.found

    /**
     * A truncated listing must suppress deletion reconciliation — the sync engine
     * hard-deletes every stored document absent from a full listing, and the
     * unlisted posts still exist on the site. Set only when posts genuinely
     * remain: a cap that lands exactly on exhaustion is a complete listing, and
     * flagging it would block deletion reconciliation forever.
     */
    if (syncContext && (stalledMidListing || (hitLimit && moreAvailable))) {
      syncContext.listingCapped = true
      logger.info('WordPress post listing truncated', {
        siteUrl,
        maxPosts,
        found: data.found,
        stalledMidListing,
      })
    }

    const nextCursor: ListCursor = { offset: newOffset, pageHandle: data.meta?.next_page }

    return {
      documents,
      hasMore,
      nextCursor: hasMore ? JSON.stringify(nextCursor) : undefined,
    }
  },

  getDocument: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    externalId: string
  ): Promise<ExternalDocument | null> => {
    const rawSiteUrl = (sourceConfig.siteUrl as string)?.trim()
    if (!rawSiteUrl) {
      throw new Error('Site URL is required')
    }
    const siteUrl = normalizeSiteUrl(rawSiteUrl)

    const url = `${WP_API_BASE}/${encodeURIComponent(siteUrl)}/posts/${encodeURIComponent(externalId)}?fields=${POST_FIELDS}`

    const response = await fetchWithRetry(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    })

    /**
     * Only a deleted post (404) resolves to `null`. Every other failure throws so
     * the sync engine records a visible failed document instead of dropping the
     * post from the run with no counter and no error log.
     */
    if (!response.ok) {
      if (response.status === 404) return null
      throw new Error(`WordPress API error: ${response.status}`)
    }

    const post = (await response.json()) as WordPressPost
    return postToDocument(post)
  },

  validateConfig: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>
  ): Promise<{ valid: boolean; error?: string }> => {
    const rawSiteUrl = (sourceConfig.siteUrl as string)?.trim()
    const maxPosts = sourceConfig.maxPosts as string | undefined

    if (!rawSiteUrl) {
      return { valid: false, error: 'Site URL is required' }
    }
    const siteUrl = normalizeSiteUrl(rawSiteUrl)
    if (!siteUrl) {
      return { valid: false, error: 'Site URL is required' }
    }

    if (maxPosts && (!Number.isFinite(Number(maxPosts)) || Number(maxPosts) <= 0)) {
      return { valid: false, error: 'Max posts must be a positive number' }
    }

    try {
      const url = `${WP_API_BASE}/${encodeURIComponent(siteUrl)}`
      const response = await fetchWithRetry(
        url,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/json',
          },
        },
        VALIDATE_RETRY_OPTIONS
      )

      if (!response.ok) {
        if (response.status === 404) {
          return { valid: false, error: `Site not found: ${siteUrl}` }
        }
        if (response.status === 401 || response.status === 403) {
          return {
            valid: false,
            error: `WordPress authorization failed (${response.status}) — reconnect the account, or check that it can access ${siteUrl}`,
          }
        }
        return { valid: false, error: `WordPress API error: ${response.status}` }
      }

      return { valid: true }
    } catch (error) {
      const message = getErrorMessage(error, 'Failed to validate configuration')
      return { valid: false, error: message }
    }
  },

  mapTags: (metadata: Record<string, unknown>): Record<string, unknown> => {
    const result: Record<string, unknown> = {}

    if (typeof metadata.author === 'string') {
      result.author = metadata.author
    }

    const lastModified = parseTagDate(metadata.lastModified)
    if (lastModified) {
      result.lastModified = lastModified
    }

    if (typeof metadata.postType === 'string') {
      result.postType = metadata.postType
    }

    const categories = joinTagArray(metadata.categories)
    if (categories) {
      result.categories = categories
    }

    const tags = joinTagArray(metadata.tags)
    if (tags) {
      result.tags = tags
    }

    return result
  },
}
