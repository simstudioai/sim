import { createLogger } from '@sim/logger'
import { IntercomIcon } from '@/components/icons'
import { fetchWithRetry, VALIDATE_RETRY_OPTIONS } from '@/lib/knowledge/documents/utils'
import type { ConnectorConfig, ExternalDocument, ExternalDocumentList } from '@/connectors/types'
import { htmlToPlainText, parseTagDate } from '@/connectors/utils'

const logger = createLogger('IntercomConnector')

const INTERCOM_API_BASE = 'https://api.intercom.io'
const DEFAULT_MAX_ITEMS = 500
const ARTICLES_PER_PAGE = 50
const CONVERSATIONS_PER_PAGE = 50

/** Intercom article as returned by GET /articles */
interface IntercomArticle {
  type: string
  id: string
  title: string
  description: string | null
  body: string | null
  author_id: number
  state: 'published' | 'draft'
  created_at: number
  updated_at: number
  url?: string
  parent_id?: number | null
  parent_type?: string | null
}

/** Intercom conversation as returned by GET /conversations */
interface IntercomConversation {
  type: string
  id: string
  created_at: number
  updated_at: number
  title: string | null
  state: string
  open: boolean
  source: {
    type: string
    id: string
    subject: string
    body: string
    author: { type: string; id: string; name?: string }
    delivered_as: string
  }
  tags: { type: string; tags: { id: string; name: string }[] }
  conversation_parts?: {
    type: string
    conversation_parts: IntercomConversationPart[]
    total_count: number
  }
}

/** A single part within a conversation */
interface IntercomConversationPart {
  type: string
  id: string
  part_type: string
  body: string | null
  created_at: number
  author: { type: string; id: string; name?: string }
}

/**
 * Makes a GET request to the Intercom API with Bearer token auth.
 */
async function intercomApiGet(
  path: string,
  accessToken: string,
  params?: Record<string, string>,
  retryOptions?: Parameters<typeof fetchWithRetry>[2]
): Promise<Record<string, unknown>> {
  const url = new URL(`${INTERCOM_API_BASE}${path}`)
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
        'Intercom-Version': '2.11',
      },
    },
    retryOptions
  )

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '')
    throw new Error(`Intercom API HTTP error ${response.status}: ${errorBody}`)
  }

  return (await response.json()) as Record<string, unknown>
}

/**
 * Fetches all articles from Intercom, respecting page-based pagination and max items cap.
 */
async function fetchArticles(
  accessToken: string,
  maxItems: number,
  stateFilter: string
): Promise<IntercomArticle[]> {
  const allArticles: IntercomArticle[] = []
  let page = 1

  while (allArticles.length < maxItems) {
    const data = await intercomApiGet('/articles', accessToken, {
      page: String(page),
      per_page: String(ARTICLES_PER_PAGE),
    })

    const articles = (data.data as IntercomArticle[]) || []
    if (articles.length === 0) break

    for (const article of articles) {
      if (stateFilter !== 'all' && article.state !== stateFilter) continue
      allArticles.push(article)
      if (allArticles.length >= maxItems) break
    }

    const pages = data.pages as { total_pages?: number } | null
    if (!pages?.total_pages || page >= pages.total_pages) break
    page++
  }

  return allArticles
}

/**
 * Fetches conversations from Intercom using cursor-based pagination.
 */
async function fetchConversations(
  accessToken: string,
  maxItems: number,
  stateFilter: string
): Promise<IntercomConversation[]> {
  const allConversations: IntercomConversation[] = []
  let startingAfter: string | undefined

  while (allConversations.length < maxItems) {
    const params: Record<string, string> = {
      per_page: String(Math.min(CONVERSATIONS_PER_PAGE, 150)),
    }
    if (startingAfter) {
      params.starting_after = startingAfter
    }

    const data = await intercomApiGet('/conversations', accessToken, params)
    const conversations = (data.conversations as IntercomConversation[]) || []
    if (conversations.length === 0) break

    for (const conversation of conversations) {
      if (stateFilter !== 'all' && conversation.state !== stateFilter) continue
      allConversations.push(conversation)
      if (allConversations.length >= maxItems) break
    }

    const pages = data.pages as { next?: { starting_after?: string } } | null
    const nextCursor = pages?.next?.starting_after
    if (!nextCursor) break
    startingAfter = nextCursor
  }

  return allConversations
}

/**
 * Fetches the full conversation with conversation_parts included.
 */
async function fetchConversationDetail(
  accessToken: string,
  conversationId: string
): Promise<IntercomConversation> {
  const data = await intercomApiGet(`/conversations/${conversationId}`, accessToken)
  return data as unknown as IntercomConversation
}

/**
 * Converts a conversation (with parts) into a plain text document.
 */
function formatConversation(conversation: IntercomConversation): string {
  const lines: string[] = []

  if (conversation.title) {
    lines.push(`Subject: ${conversation.title}`)
  }

  const sourceBody = conversation.source?.body
  if (sourceBody) {
    const authorName =
      conversation.source.author?.name || conversation.source.author?.type || 'unknown'
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

export const intercomConnector: ConnectorConfig = {
  id: 'intercom',
  name: 'Intercom',
  description: 'Sync Help Center articles and conversations from Intercom into your knowledge base',
  version: '1.0.0',
  icon: IntercomIcon,

  auth: {
    mode: 'apiKey',
    label: 'Access Token',
    placeholder: 'Enter your Intercom access token',
  },

  configFields: [
    {
      id: 'contentType',
      title: 'Content Type',
      type: 'dropdown',
      required: true,
      description: 'Choose what to sync from Intercom',
      options: [
        { label: 'Articles Only', id: 'articles' },
        { label: 'Conversations Only', id: 'conversations' },
        { label: 'Articles & Conversations', id: 'both' },
      ],
    },
    {
      id: 'articleState',
      title: 'Article State',
      type: 'dropdown',
      required: false,
      description: 'Filter articles by state (default: published)',
      options: [
        { label: 'Published', id: 'published' },
        { label: 'Draft', id: 'draft' },
        { label: 'All', id: 'all' },
      ],
    },
    {
      id: 'conversationState',
      title: 'Conversation State',
      type: 'dropdown',
      required: false,
      description: 'Filter conversations by state (default: all)',
      options: [
        { label: 'Open', id: 'open' },
        { label: 'Closed', id: 'closed' },
        { label: 'All', id: 'all' },
      ],
    },
    {
      id: 'maxItems',
      title: 'Max Items',
      type: 'short-input',
      required: false,
      placeholder: `e.g. 200 (default: ${DEFAULT_MAX_ITEMS})`,
      description: 'Maximum number of articles or conversations to sync',
    },
  ],

  listDocuments: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    _cursor?: string,
    _syncContext?: Record<string, unknown>
  ): Promise<ExternalDocumentList> => {
    const contentType = (sourceConfig.contentType as string) || 'articles'
    const articleState = (sourceConfig.articleState as string) || 'published'
    const conversationState = (sourceConfig.conversationState as string) || 'all'
    const maxItems = sourceConfig.maxItems ? Number(sourceConfig.maxItems) : DEFAULT_MAX_ITEMS

    const documents: ExternalDocument[] = []

    if (contentType === 'articles' || contentType === 'both') {
      logger.info('Fetching Intercom articles', { articleState, maxItems })
      const articles = await fetchArticles(accessToken, maxItems, articleState)

      for (const article of articles) {
        const content = formatArticle(article)
        if (!content.trim()) continue

        const updatedAt = new Date(article.updated_at * 1000).toISOString()

        documents.push({
          externalId: `article-${article.id}`,
          title: article.title || `Article ${article.id}`,
          content,
          mimeType: 'text/plain',
          sourceUrl: `https://app.intercom.com/a/apps/_/articles/articles/${article.id}/show`,
          contentHash: `intercom:article-${article.id}:${article.updated_at}`,
          metadata: {
            type: 'article',
            state: article.state,
            authorId: String(article.author_id),
            updatedAt,
            createdAt: new Date(article.created_at * 1000).toISOString(),
          },
        })
      }

      logger.info('Fetched Intercom articles', { count: articles.length })
    }

    if (contentType === 'conversations' || contentType === 'both') {
      logger.info('Fetching Intercom conversations', { conversationState, maxItems })
      const conversations = await fetchConversations(accessToken, maxItems, conversationState)

      for (const conversation of conversations) {
        const updatedAt = new Date(conversation.updated_at * 1000).toISOString()
        const tags = conversation.tags?.tags?.map((t) => t.name) || []

        documents.push({
          externalId: `conversation-${conversation.id}`,
          title: conversation.title || `Conversation #${conversation.id}`,
          content: '',
          contentDeferred: true,
          mimeType: 'text/plain',
          sourceUrl: `https://app.intercom.com/a/apps/_/inbox/inbox/all/conversations/${conversation.id}`,
          contentHash: `intercom:conversation-${conversation.id}:${conversation.updated_at}`,
          metadata: {
            type: 'conversation',
            state: conversation.state,
            tags: tags.join(', '),
            updatedAt,
            createdAt: new Date(conversation.created_at * 1000).toISOString(),
          },
        })
      }

      logger.info('Fetched Intercom conversations', { count: conversations.length })
    }

    return { documents, hasMore: false }
  },

  getDocument: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    externalId: string
  ): Promise<ExternalDocument | null> => {
    try {
      if (externalId.startsWith('article-')) {
        const articleId = externalId.replace('article-', '')
        const data = await intercomApiGet(`/articles/${articleId}`, accessToken)
        const article = data as unknown as IntercomArticle

        const content = formatArticle(article)
        if (!content.trim()) return null

        const updatedAt = new Date(article.updated_at * 1000).toISOString()

        return {
          externalId,
          title: article.title || `Article ${article.id}`,
          content,
          mimeType: 'text/plain',
          sourceUrl: `https://app.intercom.com/a/apps/_/articles/articles/${article.id}/show`,
          contentHash: `intercom:article-${article.id}:${article.updated_at}`,
          metadata: {
            type: 'article',
            state: article.state,
            authorId: String(article.author_id),
            updatedAt,
            createdAt: new Date(article.created_at * 1000).toISOString(),
          },
        }
      }

      if (externalId.startsWith('conversation-')) {
        const conversationId = externalId.replace('conversation-', '')
        const detail = await fetchConversationDetail(accessToken, conversationId)

        const content = formatConversation(detail)
        if (!content.trim()) return null

        const updatedAt = new Date(detail.updated_at * 1000).toISOString()
        const tags = detail.tags?.tags?.map((t) => t.name) || []

        return {
          externalId,
          title: detail.title || `Conversation #${detail.id}`,
          content,
          contentDeferred: false,
          mimeType: 'text/plain',
          sourceUrl: `https://app.intercom.com/a/apps/_/inbox/inbox/all/conversations/${detail.id}`,
          contentHash: `intercom:conversation-${detail.id}:${detail.updated_at}`,
          metadata: {
            type: 'conversation',
            state: detail.state,
            tags: tags.join(', '),
            updatedAt,
            createdAt: new Date(detail.created_at * 1000).toISOString(),
            messageCount: (detail.conversation_parts?.total_count ?? 0) + 1,
          },
        }
      }

      logger.warn('Unknown external ID format', { externalId })
      return null
    } catch (error) {
      logger.warn('Failed to get Intercom document', {
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
    const contentType = sourceConfig.contentType as string | undefined
    const maxItems = sourceConfig.maxItems as string | undefined

    if (!contentType) {
      return { valid: false, error: 'Content type is required' }
    }

    if (maxItems && (Number.isNaN(Number(maxItems)) || Number(maxItems) <= 0)) {
      return { valid: false, error: 'Max items must be a positive number' }
    }

    try {
      // Verify API access by fetching the first page of articles or conversations
      if (contentType === 'articles' || contentType === 'both') {
        await intercomApiGet(
          '/articles',
          accessToken,
          { page: '1', per_page: '1' },
          VALIDATE_RETRY_OPTIONS
        )
      }

      if (contentType === 'conversations' || contentType === 'both') {
        await intercomApiGet(
          '/conversations',
          accessToken,
          { per_page: '1' },
          VALIDATE_RETRY_OPTIONS
        )
      }

      return { valid: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to validate configuration'
      return { valid: false, error: message }
    }
  },

  tagDefinitions: [
    { id: 'type', displayName: 'Content Type', fieldType: 'text' },
    { id: 'state', displayName: 'State', fieldType: 'text' },
    { id: 'tags', displayName: 'Tags', fieldType: 'text' },
    { id: 'authorId', displayName: 'Author ID', fieldType: 'text' },
    { id: 'messageCount', displayName: 'Message Count', fieldType: 'number' },
    { id: 'updatedAt', displayName: 'Last Updated', fieldType: 'date' },
  ],

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

    if (typeof metadata.messageCount === 'number') {
      result.messageCount = metadata.messageCount
    }

    const updatedAt = parseTagDate(metadata.updatedAt)
    if (updatedAt) {
      result.updatedAt = updatedAt
    }

    return result
  },
}
