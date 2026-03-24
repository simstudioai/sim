import { createLogger } from '@sim/logger'
import { ZendeskIcon } from '@/components/icons'
import { fetchWithRetry, VALIDATE_RETRY_OPTIONS } from '@/lib/knowledge/documents/utils'
import type { ConnectorConfig, ExternalDocument, ExternalDocumentList } from '@/connectors/types'
import { computeContentHash, htmlToPlainText, joinTagArray, parseTagDate } from '@/connectors/utils'

const logger = createLogger('ZendeskConnector')

const ARTICLES_PER_PAGE = 30
const TICKETS_PER_PAGE = 100
const DEFAULT_MAX_TICKETS = 500

interface ZendeskArticle {
  id: number
  title: string
  body: string
  html_url: string
  section_id: number | null
  label_names: string[]
  author_id: number
  locale: string
  created_at: string
  updated_at: string
  edited_at: string
  draft: boolean
}

interface ZendeskTicket {
  id: number
  subject: string
  description: string
  status: string
  priority: string | null
  tags: string[]
  requester_id: number
  assignee_id: number | null
  created_at: string
  updated_at: string
}

interface ZendeskComment {
  id: number
  body: string
  html_body: string
  author_id: number
  created_at: string
  public: boolean
}

/**
 * Builds the base URL for a Zendesk subdomain.
 */
function buildBaseUrl(subdomain: string): string {
  return `https://${subdomain}.zendesk.com`
}

/**
 * Makes an authenticated GET request to the Zendesk API.
 * Uses email/token authentication.
 */
async function zendeskApiGet(
  url: string,
  accessToken: string,
  sourceConfig: Record<string, unknown>,
  retryOptions?: Parameters<typeof fetchWithRetry>[2]
): Promise<Record<string, unknown>> {
  const email = sourceConfig.email as string

  const response = await fetchWithRetry(
    url,
    {
      method: 'GET',
      headers: {
        Authorization: `Basic ${btoa(`${email}/token:${accessToken}`)}`,
        Accept: 'application/json',
      },
    },
    retryOptions
  )

  if (!response.ok) {
    throw new Error(`Zendesk API HTTP error: ${response.status}`)
  }

  return (await response.json()) as Record<string, unknown>
}

/**
 * Fetches all Help Center articles with pagination.
 */
async function fetchArticles(
  subdomain: string,
  accessToken: string,
  sourceConfig: Record<string, unknown>,
  locale?: string
): Promise<ZendeskArticle[]> {
  const allArticles: ZendeskArticle[] = []
  const baseUrl = buildBaseUrl(subdomain)
  const localePath = locale ? `/${locale}` : ''
  let page = 1

  while (true) {
    const url = `${baseUrl}/api/v2/help_center${localePath}/articles.json?page=${page}&per_page=${ARTICLES_PER_PAGE}`
    const data = await zendeskApiGet(url, accessToken, sourceConfig)
    const articles = (data.articles as ZendeskArticle[]) || []

    if (articles.length === 0) break

    allArticles.push(...articles)

    if (!data.next_page) break
    page++
  }

  return allArticles
}

/**
 * Fetches tickets with optional status filtering and pagination.
 */
async function fetchTickets(
  subdomain: string,
  accessToken: string,
  sourceConfig: Record<string, unknown>,
  statusFilter?: string,
  maxTickets?: number
): Promise<ZendeskTicket[]> {
  const allTickets: ZendeskTicket[] = []
  const baseUrl = buildBaseUrl(subdomain)
  const limit = maxTickets || DEFAULT_MAX_TICKETS
  let url: string | null = `${baseUrl}/api/v2/tickets.json?per_page=${TICKETS_PER_PAGE}`

  if (statusFilter && statusFilter !== 'all') {
    url = `${baseUrl}/api/v2/search.json?query=type:ticket status:${statusFilter}&per_page=${TICKETS_PER_PAGE}`
  }

  while (url && allTickets.length < limit) {
    const data = await zendeskApiGet(url, accessToken, sourceConfig)
    const tickets = ((data.tickets || data.results) as ZendeskTicket[]) || []

    if (tickets.length === 0) break

    allTickets.push(...tickets)

    url = (data.next_page as string) || null
  }

  return allTickets.slice(0, limit)
}

/**
 * Fetches all comments for a ticket.
 */
async function fetchTicketComments(
  subdomain: string,
  accessToken: string,
  sourceConfig: Record<string, unknown>,
  ticketId: number
): Promise<ZendeskComment[]> {
  const allComments: ZendeskComment[] = []
  const baseUrl = buildBaseUrl(subdomain)
  let url: string | null = `${baseUrl}/api/v2/tickets/${ticketId}/comments.json?per_page=100`

  while (url) {
    const data = await zendeskApiGet(url, accessToken, sourceConfig)
    const comments = (data.comments as ZendeskComment[]) || []

    allComments.push(...comments)

    url = (data.next_page as string) || null
  }

  return allComments
}

/**
 * Formats ticket with its comments into a single document content string.
 */
function formatTicketContent(ticket: ZendeskTicket, comments: ZendeskComment[]): string {
  const parts: string[] = []

  parts.push(`Subject: ${ticket.subject}`)
  parts.push(`Status: ${ticket.status}`)
  if (ticket.priority) {
    parts.push(`Priority: ${ticket.priority}`)
  }
  parts.push(`Created: ${ticket.created_at}`)
  parts.push(`Updated: ${ticket.updated_at}`)
  if (ticket.tags.length > 0) {
    parts.push(`Tags: ${ticket.tags.join(', ')}`)
  }
  parts.push('')
  parts.push('--- Description ---')
  parts.push(htmlToPlainText(ticket.description))

  if (comments.length > 0) {
    parts.push('')
    parts.push('--- Comments ---')
    for (const comment of comments) {
      const visibility = comment.public ? 'Public' : 'Internal'
      parts.push(`\n[${comment.created_at}] (${visibility}) Author ${comment.author_id}:`)
      parts.push(htmlToPlainText(comment.html_body || comment.body))
    }
  }

  return parts.join('\n')
}

/**
 * Converts an article to an ExternalDocument.
 */
async function articleToDocument(
  article: ZendeskArticle,
  subdomain: string
): Promise<ExternalDocument> {
  const content = htmlToPlainText(article.body || '')
  const contentHash = await computeContentHash(content)

  return {
    externalId: `article-${article.id}`,
    title: article.title,
    content,
    mimeType: 'text/plain',
    sourceUrl: article.html_url || `https://${subdomain}.zendesk.com/hc/articles/${article.id}`,
    contentHash,
    metadata: {
      type: 'article',
      articleId: article.id,
      sectionId: article.section_id,
      labels: article.label_names,
      author: String(article.author_id),
      locale: article.locale,
      draft: article.draft,
      createdAt: article.created_at,
      updatedAt: article.updated_at,
    },
  }
}

/**
 * Converts a ticket (with comments) to an ExternalDocument.
 */
async function ticketToDocument(
  ticket: ZendeskTicket,
  comments: ZendeskComment[],
  subdomain: string
): Promise<ExternalDocument> {
  const content = formatTicketContent(ticket, comments)
  const contentHash = await computeContentHash(content)

  return {
    externalId: `ticket-${ticket.id}`,
    title: `Ticket #${ticket.id}: ${ticket.subject}`,
    content,
    mimeType: 'text/plain',
    sourceUrl: `https://${subdomain}.zendesk.com/agent/tickets/${ticket.id}`,
    contentHash,
    metadata: {
      type: 'ticket',
      ticketId: ticket.id,
      status: ticket.status,
      priority: ticket.priority,
      tags: ticket.tags,
      commentCount: comments.length,
      createdAt: ticket.created_at,
      updatedAt: ticket.updated_at,
    },
  }
}

export const zendeskConnector: ConnectorConfig = {
  id: 'zendesk',
  name: 'Zendesk',
  description:
    'Sync Help Center articles and support tickets from Zendesk into your knowledge base',
  version: '1.0.0',
  icon: ZendeskIcon,

  auth: {
    mode: 'apiKey',
    label: 'API Token',
    placeholder: 'Enter your Zendesk API token',
  },

  configFields: [
    {
      id: 'subdomain',
      title: 'Subdomain',
      type: 'short-input',
      placeholder: 'yourcompany (from yourcompany.zendesk.com)',
      required: true,
      description: 'Your Zendesk subdomain',
    },
    {
      id: 'email',
      title: 'Email',
      type: 'short-input',
      placeholder: 'agent@yourcompany.com',
      required: true,
      description: 'Email address of the Zendesk user for API authentication',
    },
    {
      id: 'contentType',
      title: 'Content Type',
      type: 'dropdown',
      required: true,
      description: 'What content to sync from Zendesk',
      options: [
        { label: 'Articles & Tickets', id: 'both' },
        { label: 'Help Center Articles Only', id: 'articles' },
        { label: 'Support Tickets Only', id: 'tickets' },
      ],
    },
    {
      id: 'ticketStatus',
      title: 'Ticket Status Filter',
      type: 'dropdown',
      required: false,
      description: 'Filter tickets by status (applies only when syncing tickets)',
      options: [
        { label: 'All Statuses', id: 'all' },
        { label: 'Open', id: 'open' },
        { label: 'Pending', id: 'pending' },
        { label: 'Solved', id: 'solved' },
        { label: 'Closed', id: 'closed' },
      ],
    },
    {
      id: 'locale',
      title: 'Article Locale',
      type: 'short-input',
      required: false,
      placeholder: 'e.g. en-us (default: all locales)',
      description: 'Locale for Help Center articles',
    },
    {
      id: 'maxTickets',
      title: 'Max Tickets',
      type: 'short-input',
      required: false,
      placeholder: `e.g. 200 (default: ${DEFAULT_MAX_TICKETS})`,
      description: 'Maximum number of tickets to sync',
    },
  ],

  listDocuments: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    _cursor?: string,
    _syncContext?: Record<string, unknown>
  ): Promise<ExternalDocumentList> => {
    const subdomain = (sourceConfig.subdomain as string)?.trim()
    if (!subdomain) {
      throw new Error('Subdomain is required')
    }

    const email = sourceConfig.email as string
    if (!email?.trim()) {
      throw new Error('Email is required')
    }

    const contentType = (sourceConfig.contentType as string) || 'both'
    const ticketStatus = sourceConfig.ticketStatus as string | undefined
    const locale = (sourceConfig.locale as string)?.trim() || undefined
    const maxTickets = sourceConfig.maxTickets
      ? Number(sourceConfig.maxTickets)
      : DEFAULT_MAX_TICKETS

    const documents: ExternalDocument[] = []

    if (contentType === 'articles' || contentType === 'both') {
      logger.info('Fetching Zendesk Help Center articles', { subdomain, locale })
      const articles = await fetchArticles(subdomain, accessToken, sourceConfig, locale)
      logger.info(`Fetched ${articles.length} articles from Zendesk`)

      for (const article of articles) {
        if (!article.body?.trim()) continue
        const doc = await articleToDocument(article, subdomain)
        documents.push(doc)
      }
    }

    if (contentType === 'tickets' || contentType === 'both') {
      logger.info('Fetching Zendesk support tickets', { subdomain, ticketStatus, maxTickets })
      const tickets = await fetchTickets(
        subdomain,
        accessToken,
        sourceConfig,
        ticketStatus,
        maxTickets
      )
      logger.info(`Fetched ${tickets.length} tickets from Zendesk`)

      const BATCH_SIZE = 5
      for (let i = 0; i < tickets.length; i += BATCH_SIZE) {
        const batch = tickets.slice(i, i + BATCH_SIZE)
        const batchResults = await Promise.all(
          batch.map(async (ticket) => {
            const comments = await fetchTicketComments(
              subdomain,
              accessToken,
              sourceConfig,
              ticket.id
            )
            return ticketToDocument(ticket, comments, subdomain)
          })
        )
        documents.push(...batchResults)
      }
    }

    return {
      documents,
      hasMore: false,
    }
  },

  getDocument: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    externalId: string
  ): Promise<ExternalDocument | null> => {
    const subdomain = (sourceConfig.subdomain as string)?.trim()
    if (!subdomain) return null

    try {
      if (externalId.startsWith('article-')) {
        const articleId = externalId.replace('article-', '')
        const baseUrl = buildBaseUrl(subdomain)
        const url = `${baseUrl}/api/v2/help_center/articles/${articleId}.json`
        const data = await zendeskApiGet(url, accessToken, sourceConfig)
        const article = data.article as ZendeskArticle
        if (!article) return null
        return articleToDocument(article, subdomain)
      }

      if (externalId.startsWith('ticket-')) {
        const ticketId = Number(externalId.replace('ticket-', ''))
        const baseUrl = buildBaseUrl(subdomain)
        const url = `${baseUrl}/api/v2/tickets/${ticketId}.json`
        const data = await zendeskApiGet(url, accessToken, sourceConfig)
        const ticket = data.ticket as ZendeskTicket
        if (!ticket) return null
        const comments = await fetchTicketComments(subdomain, accessToken, sourceConfig, ticketId)
        return ticketToDocument(ticket, comments, subdomain)
      }

      return null
    } catch (error) {
      logger.warn('Failed to get Zendesk document', {
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
    const subdomain = (sourceConfig.subdomain as string)?.trim()
    if (!subdomain) {
      return { valid: false, error: 'Subdomain is required' }
    }

    const email = (sourceConfig.email as string)?.trim()
    if (!email) {
      return { valid: false, error: 'Email is required' }
    }

    const contentType = sourceConfig.contentType as string | undefined
    if (!contentType) {
      return { valid: false, error: 'Content type is required' }
    }

    const maxTickets = sourceConfig.maxTickets as string | undefined
    if (maxTickets && (Number.isNaN(Number(maxTickets)) || Number(maxTickets) <= 0)) {
      return { valid: false, error: 'Max tickets must be a positive number' }
    }

    try {
      const baseUrl = buildBaseUrl(subdomain)
      const url = `${baseUrl}/api/v2/users/me.json`
      await zendeskApiGet(url, accessToken, sourceConfig, VALIDATE_RETRY_OPTIONS)
      return { valid: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to validate configuration'
      return { valid: false, error: message }
    }
  },

  tagDefinitions: [
    { id: 'contentType', displayName: 'Content Type', fieldType: 'text' },
    { id: 'status', displayName: 'Status', fieldType: 'text' },
    { id: 'labels', displayName: 'Labels', fieldType: 'text' },
    { id: 'tags', displayName: 'Tags', fieldType: 'text' },
    { id: 'updatedAt', displayName: 'Last Updated', fieldType: 'date' },
    { id: 'commentCount', displayName: 'Comment Count', fieldType: 'number' },
  ],

  mapTags: (metadata: Record<string, unknown>): Record<string, unknown> => {
    const result: Record<string, unknown> = {}

    if (typeof metadata.type === 'string') {
      result.contentType = metadata.type
    }

    if (typeof metadata.status === 'string') {
      result.status = metadata.status
    }

    const labels = joinTagArray(metadata.labels)
    if (labels) {
      result.labels = labels
    }

    const tags = joinTagArray(metadata.tags)
    if (tags) {
      result.tags = tags
    }

    const updatedAt = parseTagDate(metadata.updatedAt)
    if (updatedAt) {
      result.updatedAt = updatedAt
    }

    if (typeof metadata.commentCount === 'number') {
      result.commentCount = metadata.commentCount
    }

    return result
  },
}
