import { createLogger } from '@sim/logger'
import { WordpressIcon } from '@/components/icons'
import { fetchWithRetry, VALIDATE_RETRY_OPTIONS } from '@/lib/knowledge/documents/utils'
import type { ConnectorConfig, ExternalDocument, ExternalDocumentList } from '@/connectors/types'
import { htmlToPlainText, joinTagArray, parseTagDate } from '@/connectors/utils'

const logger = createLogger('WordPressConnector')

const WP_API_BASE = 'https://public-api.wordpress.com/rest/v1.1/sites'

/**
 * Strips protocol prefix and trailing slashes from a site URL so the
 * WordPress.com API receives a bare domain (e.g. "mysite.wordpress.com").
 */
function normalizeSiteUrl(raw: string): string {
  return raw.replace(/^https?:\/\//, '').replace(/\/+$/, '')
}

const POSTS_PER_PAGE = 20
const DEFAULT_MAX_POSTS = 100

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
}

interface ListCursor {
  offset: number
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
  const plainText = htmlToPlainText(post.content)
  const fullContent = `# ${post.title}\n\n${plainText}`
  const contentHash = `wordpress:${post.ID}:${post.modified || ''}`
  const categories = extractCategoryNames(post.categories)
  const tags = extractTagNames(post.tags)

  return {
    externalId: String(post.ID),
    title: post.title || 'Untitled',
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
  id: 'wordpress',
  name: 'WordPress',
  description:
    'Sync posts and pages from a WordPress.com site. OAuth tokens expire after ~2 weeks (no refresh token).',
  version: '1.0.0',
  icon: WordpressIcon,

  auth: { mode: 'oauth', provider: 'wordpress', requiredScopes: ['global'] },

  configFields: [
    {
      id: 'siteUrl',
      title: 'Site URL',
      type: 'short-input',
      placeholder: 'e.g. mysite.wordpress.com',
      required: true,
      description: 'WordPress site domain',
    },
    {
      id: 'postType',
      title: 'Post Type',
      type: 'dropdown',
      required: false,
      description: 'Filter by content type',
      options: [
        { label: 'Both', id: 'Both' },
        { label: 'Posts', id: 'Posts' },
        { label: 'Pages', id: 'Pages' },
      ],
    },
    {
      id: 'maxPosts',
      title: 'Max Posts',
      type: 'short-input',
      required: false,
      placeholder: `e.g. 50 (default: ${DEFAULT_MAX_POSTS})`,
      description: 'Maximum number of posts to sync',
    },
  ],

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

    const maxPosts = sourceConfig.maxPosts ? Number(sourceConfig.maxPosts) : DEFAULT_MAX_POSTS
    const type = resolvePostType(sourceConfig.postType as string | undefined)

    const parsed: ListCursor = cursor ? JSON.parse(cursor) : { offset: 0 }
    const totalDocsFetched = (syncContext?.totalDocsFetched as number) ?? 0

    const remaining = maxPosts > 0 ? maxPosts - totalDocsFetched : POSTS_PER_PAGE
    if (remaining <= 0) {
      return { documents: [], hasMore: false }
    }

    const pageSize = Math.min(POSTS_PER_PAGE, remaining)
    const url = `${WP_API_BASE}/${encodeURIComponent(siteUrl)}/posts?number=${pageSize}&offset=${parsed.offset}&type=${type}`

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
    const hitLimit = maxPosts > 0 && totalFetched >= maxPosts

    const newOffset = parsed.offset + posts.length
    const hasMore = !hitLimit && newOffset < data.found

    return {
      documents,
      hasMore,
      nextCursor: hasMore ? JSON.stringify({ offset: newOffset }) : undefined,
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

    const url = `${WP_API_BASE}/${encodeURIComponent(siteUrl)}/posts/${externalId}`

    try {
      const response = await fetchWithRetry(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
      })

      if (!response.ok) {
        if (response.status === 404) return null
        throw new Error(`WordPress API error: ${response.status}`)
      }

      const post = (await response.json()) as WordPressPost
      return postToDocument(post)
    } catch (error) {
      logger.warn('Failed to get WordPress document', {
        externalId,
        error: error instanceof Error ? error.message : String(error),
      })
      return null
    }
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

    if (maxPosts && (Number.isNaN(Number(maxPosts)) || Number(maxPosts) <= 0)) {
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
        return { valid: false, error: `WordPress API error: ${response.status}` }
      }

      return { valid: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to validate configuration'
      return { valid: false, error: message }
    }
  },

  tagDefinitions: [
    { id: 'author', displayName: 'Author', fieldType: 'text' },
    { id: 'lastModified', displayName: 'Last Modified', fieldType: 'date' },
    { id: 'postType', displayName: 'Post Type', fieldType: 'text' },
    { id: 'categories', displayName: 'Categories', fieldType: 'text' },
    { id: 'tags', displayName: 'Tags', fieldType: 'text' },
  ],

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
