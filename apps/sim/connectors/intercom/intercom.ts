import { createLogger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import { z } from 'zod'
import { fetchWithRetry, VALIDATE_RETRY_OPTIONS } from '@/lib/knowledge/documents/utils'
import {
  DEFAULT_INTERCOM_REGION,
  DEFAULT_MAX_ITEMS,
  INTERCOM_API_BASE_BY_REGION,
  intercomConnectorMeta,
} from '@/connectors/intercom/meta'
import type { ConnectorConfig, ExternalDocument, ExternalDocumentList } from '@/connectors/types'
import { htmlToPlainText, parseTagDate } from '@/connectors/utils'

const logger = createLogger('IntercomConnector')

/**
 * Intercom pins request/response shapes to an `Intercom-Version` header. 2.11 is a
 * supported version (Intercom supports 2.7+) and is the version whose documented
 * schemas this connector parses.
 *
 * @see https://developers.intercom.com/docs/build-an-integration/learn-more/rest-apis/api-versioning
 */
const INTERCOM_API_VERSION = '2.11'

/**
 * `/articles` is page-number paginated (`page` selects the n-th chunk of `per_page`
 * records), so `per_page` must stay constant across pages or a later page would
 * slide backwards and skip articles. Intercom caps `per_page` at 150 API-wide.
 */
const ARTICLES_PER_PAGE = 50
/** Intercom caps `per_page` at 150 across every list API. */
const CONVERSATIONS_PER_PAGE = 150

/** Intercom returns at most 500 conversation parts per conversation. */
const MAX_CONVERSATION_PARTS = 500

const CONTENT_TYPES = new Set(['articles', 'conversations', 'both'])

/**
 * Every schema here models only the fields this connector reads. `.passthrough()`
 * carries the rest of Intercom's payload through untouched, so unmodeled or newly
 * added fields never fail a parse.
 */
const IntercomAuthorSchema = z
  .object({
    type: z.string().optional(),
    name: z.string().nullable().optional(),
  })
  .passthrough()

const IntercomArticleSchema = z
  .object({
    id: z.string(),
    title: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    body: z.string().nullable().optional(),
    author_id: z.union([z.number(), z.string()]).nullable().optional(),
    state: z.string(),
    created_at: z.number(),
    updated_at: z.number(),
    url: z.string().nullable().optional(),
  })
  .passthrough()

type IntercomArticle = z.infer<typeof IntercomArticleSchema>

const IntercomConversationPartSchema = z
  .object({
    body: z.string().nullable().optional(),
    created_at: z.number(),
    author: IntercomAuthorSchema.optional(),
  })
  .passthrough()

const IntercomConversationSchema = z
  .object({
    id: z.string(),
    created_at: z.number(),
    updated_at: z.number(),
    title: z.string().nullable().optional(),
    state: z.string(),
    source: z
      .object({
        body: z.string().nullable().optional(),
        author: IntercomAuthorSchema.optional(),
      })
      .passthrough()
      .optional(),
    tags: z
      .object({
        tags: z.array(z.object({ name: z.string() }).passthrough()).default([]),
      })
      .passthrough()
      .optional(),
    /** Omitted entirely by `GET /conversations`; only the single-conversation fetch returns it. */
    conversation_parts: z
      .object({
        conversation_parts: z.array(IntercomConversationPartSchema).default([]),
        total_count: z.number().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough()

type IntercomConversation = z.infer<typeof IntercomConversationSchema>

/** HTTP failure from the Intercom API, carrying the status so callers can branch on 404. */
class IntercomHttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
    this.name = 'IntercomHttpError'
  }
}

/**
 * Resolves the regional REST host for the workspace. Intercom serves EU and AU
 * workspaces from dedicated hosts; an unset/unknown region falls back to US.
 */
function resolveApiBase(sourceConfig: Record<string, unknown>): string {
  const region =
    typeof sourceConfig.region === 'string' ? sourceConfig.region.trim().toLowerCase() : ''
  return (
    INTERCOM_API_BASE_BY_REGION[region as keyof typeof INTERCOM_API_BASE_BY_REGION] ??
    INTERCOM_API_BASE_BY_REGION[DEFAULT_INTERCOM_REGION]
  )
}

/**
 * Makes a GET request to the Intercom API with Bearer token auth.
 */
async function intercomApiGet(
  apiBase: string,
  path: string,
  accessToken: string,
  params?: Record<string, string>,
  retryOptions?: Parameters<typeof fetchWithRetry>[2]
): Promise<Record<string, unknown>> {
  const url = new URL(`${apiBase}${path}`)
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value)
    }
  }

  const response = await fetchWithRetry(
    url.toString(),
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
        'Intercom-Version': INTERCOM_API_VERSION,
      },
    },
    retryOptions
  )

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '')
    throw new IntercomHttpError(
      response.status,
      `Intercom API HTTP error ${response.status}: ${errorBody}`
    )
  }

  return (await response.json()) as Record<string, unknown>
}

/**
 * Fetches articles using Intercom's page-based `/articles` pagination.
 *
 * `capped` reports whether the `maxItems` budget hid articles that still exist in
 * the source. A budget landing exactly on source exhaustion is NOT capped — the
 * listing is complete and deletion reconciliation must stay enabled.
 */
async function fetchArticles(
  apiBase: string,
  accessToken: string,
  maxItems: number,
  stateFilter: string
): Promise<{ articles: IntercomArticle[]; capped: boolean }> {
  const collected: IntercomArticle[] = []
  let page = 1
  let capped = false

  while (collected.length < maxItems) {
    const data = await intercomApiGet(apiBase, '/articles', accessToken, {
      page: String(page),
      per_page: String(ARTICLES_PER_PAGE),
    })

    const articles = z.array(IntercomArticleSchema).parse(data.data ?? [])
    if (articles.length === 0) break

    let consumed = 0
    for (const article of articles) {
      consumed++
      if (stateFilter !== 'all' && article.state !== stateFilter) continue
      collected.push(article)
      if (collected.length >= maxItems) break
    }

    const pages = data.pages as { total_pages?: number } | null
    const morePages = Boolean(pages?.total_pages && page < pages.total_pages)

    if (collected.length >= maxItems) {
      capped = consumed < articles.length || morePages
      break
    }
    if (!morePages) break
    page++
  }

  return { articles: collected, capped }
}

/**
 * Fetches conversations using Intercom's cursor-based `/conversations` pagination
 * (`pages.next.starting_after`).
 *
 * See {@link fetchArticles} for the `capped` contract.
 */
async function fetchConversations(
  apiBase: string,
  accessToken: string,
  maxItems: number,
  stateFilter: string
): Promise<{ conversations: IntercomConversation[]; capped: boolean }> {
  const collected: IntercomConversation[] = []
  let startingAfter: string | undefined
  let capped = false

  while (collected.length < maxItems) {
    /**
     * `/conversations` is cursor paginated, so shrinking the last page is safe.
     * A state filter drops rows client-side, so only an unfiltered listing can
     * size the page from the remaining budget.
     */
    const perPage =
      stateFilter === 'all'
        ? Math.min(CONVERSATIONS_PER_PAGE, maxItems - collected.length)
        : CONVERSATIONS_PER_PAGE

    const params: Record<string, string> = { per_page: String(perPage) }
    if (startingAfter) {
      params.starting_after = startingAfter
    }

    const data = await intercomApiGet(apiBase, '/conversations', accessToken, params)
    const conversations = z.array(IntercomConversationSchema).parse(data.conversations ?? [])
    if (conversations.length === 0) break

    let consumed = 0
    for (const conversation of conversations) {
      consumed++
      if (stateFilter !== 'all' && conversation.state !== stateFilter) continue
      collected.push(conversation)
      if (collected.length >= maxItems) break
    }

    const pages = data.pages as { next?: { starting_after?: string | null } | null } | null
    const nextCursor = pages?.next?.starting_after || undefined

    if (collected.length >= maxItems) {
      capped = consumed < conversations.length || Boolean(nextCursor)
      break
    }
    if (!nextCursor) break
    startingAfter = nextCursor
  }

  return { conversations: collected, capped }
}

/**
 * Converts a conversation (with parts) into a plain text document.
 */
function formatConversation(conversation: IntercomConversation): string {
  const lines: string[] = []

  if (conversation.title) {
    lines.push(`Subject: ${conversation.title}`)
  }

  const source = conversation.source
  const sourceBody = source?.body
  if (sourceBody) {
    const authorName = source.author?.name || source.author?.type || 'unknown'
    const timestamp = new Date(conversation.created_at * 1000).toISOString()
    lines.push(`[${timestamp}] ${authorName}: ${htmlToPlainText(sourceBody)}`)
  }

  const parts = conversation.conversation_parts?.conversation_parts || []
  for (const part of parts) {
    if (!part.body) continue
    const authorName = part.author?.name || part.author?.type || 'unknown'
    const timestamp = new Date(part.created_at * 1000).toISOString()
    lines.push(`[${timestamp}] ${authorName}: ${htmlToPlainText(part.body)}`)
  }

  return lines.join('\n')
}

/**
 * Converts an article to a plain text document.
 */
function formatArticle(article: IntercomArticle): string {
  const parts: string[] = []
  if (article.title) {
    parts.push(article.title)
  }
  if (article.description) {
    parts.push(article.description)
  }
  if (article.body) {
    parts.push(htmlToPlainText(article.body))
  }
  return parts.join('\n\n')
}

function articleMetadata(article: IntercomArticle): Record<string, unknown> {
  const metadata: Record<string, unknown> = {
    type: 'article',
    state: article.state,
    updatedAt: new Date(article.updated_at * 1000).toISOString(),
    createdAt: new Date(article.created_at * 1000).toISOString(),
  }
  if (article.author_id !== undefined && article.author_id !== null) {
    metadata.authorId = String(article.author_id)
  }
  return metadata
}

/**
 * Shared article projection so `listDocuments` and `getDocument` cannot drift on
 * `externalId`, `contentHash`, or `sourceUrl`.
 */
function articleToDocument(article: IntercomArticle): ExternalDocument {
  return {
    externalId: `article-${article.id}`,
    title: article.title || `Article ${article.id}`,
    content: formatArticle(article),
    mimeType: 'text/plain',
    sourceUrl:
      article.url || `https://app.intercom.com/a/apps/_/articles/articles/${article.id}/show`,
    contentHash: `intercom:article-${article.id}:${article.updated_at}`,
    metadata: articleMetadata(article),
  }
}

function conversationMetadata(conversation: IntercomConversation): Record<string, unknown> {
  return {
    type: 'conversation',
    state: conversation.state,
    tags: (conversation.tags?.tags?.map((t) => t.name) || []).join(', '),
    updatedAt: new Date(conversation.updated_at * 1000).toISOString(),
    createdAt: new Date(conversation.created_at * 1000).toISOString(),
  }
}

/**
 * Lightweight listing stub. `/conversations` never returns `conversation_parts`
 * (documented as "ignored when Listing all Conversations"), so the transcript is
 * hydrated per-document via `getDocument`.
 */
function conversationToStub(conversation: IntercomConversation): ExternalDocument {
  return {
    externalId: `conversation-${conversation.id}`,
    title: conversation.title || `Conversation #${conversation.id}`,
    content: '',
    contentDeferred: true,
    mimeType: 'text/plain',
    sourceUrl: `https://app.intercom.com/a/apps/_/inbox/inbox/all/conversations/${conversation.id}`,
    contentHash: `intercom:conversation-${conversation.id}:${conversation.updated_at}`,
    metadata: conversationMetadata(conversation),
  }
}

export const intercomConnector: ConnectorConfig = {
  ...intercomConnectorMeta,

  listDocuments: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    _cursor?: string,
    syncContext?: Record<string, unknown>
  ): Promise<ExternalDocumentList> => {
    const apiBase = resolveApiBase(sourceConfig)
    const contentType = (sourceConfig.contentType as string) || 'articles'
    const articleState = (sourceConfig.articleState as string) || 'published'
    const conversationState = (sourceConfig.conversationState as string) || 'all'
    const parsedMax = sourceConfig.maxItems ? Number(sourceConfig.maxItems) : DEFAULT_MAX_ITEMS
    const maxItems =
      Number.isFinite(parsedMax) && parsedMax > 0 ? Math.floor(parsedMax) : DEFAULT_MAX_ITEMS

    const documents: ExternalDocument[] = []
    let capped = false

    if (contentType === 'articles' || contentType === 'both') {
      logger.info('Fetching Intercom articles', { articleState, maxItems })
      const result = await fetchArticles(apiBase, accessToken, maxItems, articleState)
      capped = capped || result.capped

      for (const article of result.articles) {
        const doc = articleToDocument(article)
        if (!doc.content.trim()) continue
        documents.push(doc)
      }

      logger.info('Fetched Intercom articles', { count: result.articles.length })
    }

    /**
     * `maxItems` is a single budget for the whole sync, so an "articles &
     * conversations" source cannot silently fetch 2x the configured cap.
     */
    const conversationBudget = maxItems - documents.length

    if ((contentType === 'conversations' || contentType === 'both') && conversationBudget > 0) {
      logger.info('Fetching Intercom conversations', { conversationState, maxItems })
      const result = await fetchConversations(
        apiBase,
        accessToken,
        conversationBudget,
        conversationState
      )
      capped = capped || result.capped

      for (const conversation of result.conversations) {
        documents.push(conversationToStub(conversation))
      }

      logger.info('Fetched Intercom conversations', { count: result.conversations.length })
    } else if (contentType === 'both' && conversationBudget <= 0) {
      capped = true
    }

    /**
     * The sync engine hard-deletes stored documents absent from a full listing.
     * Only flag when the cap actually hid still-existing items — flagging a
     * complete listing would permanently block deletion reconciliation.
     */
    if (capped && syncContext) {
      syncContext.listingCapped = true
      logger.warn('Intercom listing truncated by maxItems; skipping deletion reconciliation', {
        maxItems,
        docsListed: documents.length,
      })
    }

    return { documents, hasMore: false }
  },

  getDocument: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    externalId: string
  ): Promise<ExternalDocument | null> => {
    const apiBase = resolveApiBase(sourceConfig)

    try {
      if (externalId.startsWith('article-')) {
        const articleId = externalId.slice('article-'.length)
        const data = await intercomApiGet(
          apiBase,
          `/articles/${encodeURIComponent(articleId)}`,
          accessToken
        )
        const article = IntercomArticleSchema.parse(data)

        const doc = articleToDocument(article)
        if (!doc.content.trim()) return null
        return { ...doc, externalId }
      }

      if (externalId.startsWith('conversation-')) {
        const conversationId = externalId.slice('conversation-'.length)
        const data = await intercomApiGet(
          apiBase,
          `/conversations/${encodeURIComponent(conversationId)}`,
          accessToken
        )
        const detail = IntercomConversationSchema.parse(data)

        const content = formatConversation(detail)
        if (!content.trim()) return null

        const returnedParts = detail.conversation_parts?.conversation_parts?.length ?? 0
        const totalParts = detail.conversation_parts?.total_count ?? returnedParts
        if (totalParts > returnedParts || returnedParts >= MAX_CONVERSATION_PARTS) {
          logger.warn('Intercom returned a truncated conversation transcript', {
            externalId,
            returnedParts,
            totalParts,
            limit: MAX_CONVERSATION_PARTS,
          })
        }

        return {
          ...conversationToStub(detail),
          externalId,
          content,
          contentDeferred: false,
          metadata: {
            ...conversationMetadata(detail),
            messageCount: totalParts + 1,
          },
        }
      }

      logger.warn('Unknown external ID format', { externalId })
      return null
    } catch (error) {
      /**
       * Only a genuine 404 means "gone". Anything else is a transient/unexpected
       * failure and must propagate so the sync engine records a failed document
       * instead of silently dropping it from this run.
       */
      if (error instanceof IntercomHttpError && error.status === 404) {
        logger.warn('Intercom document not found', { externalId })
        return null
      }
      logger.error('Failed to get Intercom document', {
        externalId,
        error: toError(error).message,
      })
      throw toError(error)
    }
  },

  validateConfig: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>
  ): Promise<{ valid: boolean; error?: string }> => {
    const contentType = sourceConfig.contentType as string | undefined
    const maxItems = sourceConfig.maxItems as string | undefined

    if (!contentType) {
      return { valid: false, error: 'Content type is required' }
    }

    if (!CONTENT_TYPES.has(contentType)) {
      return {
        valid: false,
        error: 'Content type must be one of: articles, conversations, both',
      }
    }

    if (maxItems && (Number.isNaN(Number(maxItems)) || Number(maxItems) <= 0)) {
      return { valid: false, error: 'Max items must be a positive number' }
    }

    const apiBase = resolveApiBase(sourceConfig)

    try {
      // Verify API access by fetching the first page of articles or conversations
      if (contentType === 'articles' || contentType === 'both') {
        await intercomApiGet(
          apiBase,
          '/articles',
          accessToken,
          { page: '1', per_page: '1' },
          VALIDATE_RETRY_OPTIONS
        )
      }

      if (contentType === 'conversations' || contentType === 'both') {
        await intercomApiGet(
          apiBase,
          '/conversations',
          accessToken,
          { per_page: '1' },
          VALIDATE_RETRY_OPTIONS
        )
      }

      return { valid: true }
    } catch (error) {
      const message = getErrorMessage(error, 'Failed to validate configuration')
      return { valid: false, error: message }
    }
  },

  mapTags: (metadata: Record<string, unknown>): Record<string, unknown> => {
    const result: Record<string, unknown> = {}

    if (typeof metadata.type === 'string') {
      result.type = metadata.type
    }

    if (typeof metadata.state === 'string') {
      result.state = metadata.state
    }

    if (typeof metadata.tags === 'string' && metadata.tags) {
      result.tags = metadata.tags
    }

    if (typeof metadata.authorId === 'string') {
      result.authorId = metadata.authorId
    }

    if (typeof metadata.messageCount === 'number' && Number.isFinite(metadata.messageCount)) {
      result.messageCount = metadata.messageCount
    }

    const updatedAt = parseTagDate(metadata.updatedAt)
    if (updatedAt) {
      result.updatedAt = updatedAt
    }

    return result
  },
}
