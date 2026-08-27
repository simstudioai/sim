import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { fetchWithRetry, VALIDATE_RETRY_OPTIONS } from '@/lib/knowledge/documents/utils'
import type { ConnectorConfig, ExternalDocument, ExternalDocumentList } from '@/connectors/types'
import { htmlToPlainText, joinTagArray, parseMultiValue, parseTagDate } from '@/connectors/utils'
import {
  DEFAULT_MAX_ARTICLES,
  DEFAULT_MAX_TICKETS,
  DEFAULT_ZOHO_DESK_DATA_CENTER,
  ZOHO_DESK_DATA_CENTER_BASES,
  type ZohoDeskDataCenter,
  zohoDeskConnectorMeta,
} from '@/connectors/zoho-desk/meta'

const logger = createLogger('ZohoDeskConnector')

/** Zoho caps the article list at 50 per request and the ticket list at 100. */
const ARTICLES_PAGE_SIZE = 50
const TICKETS_PAGE_SIZE = 100

/** Zoho caps `/conversations` at 200 entries per request. */
const CONVERSATIONS_PAGE_SIZE = 200

/**
 * Highest `from` index any Desk list API accepts. Zoho allows paginating over at
 * most 5000 records and answers `from >= 5000` with HTTP 422
 * `UNPROCESSABLE_ENTITY: The value passed for field 'from' exceeds the range of
 * '0-4999'` — an error, not an empty page. Walking into it would abort the whole
 * listing, so the drain stops at the ceiling and reports the listing as capped.
 */
const MAX_LIST_OFFSET = 4999

/** Upper bound on conversation entries folded into one ticket document. */
const MAX_CONVERSATION_ENTRIES = 400

/**
 * Upper bound on threads hydrated to their full body for one ticket. Beyond this
 * the truncated `summary` from `/conversations` is used, so a thousand-message
 * ticket cannot turn a single `getDocument` call into a thousand HTTP requests.
 */
const MAX_HYDRATED_THREADS = 50

/** Thread bodies fetched in parallel per ticket. Kept low to stay inside Zoho's per-minute API credit budget. */
const THREAD_FETCH_CONCURRENCY = 4

interface ZohoDeskArticleSummary {
  id: string
  title?: string
  status?: string
  locale?: string
  summary?: string
  modifiedTime?: string
  createdTime?: string
  permalink?: string
  portalUrl?: string
  webUrl?: string
  categoryId?: string
  category?: { id?: string; name?: string }
  tags?: string[]
  isTrashed?: boolean
}

interface ZohoDeskArticleDetail extends ZohoDeskArticleSummary {
  answer?: string
}

interface ZohoDeskTicket {
  id: string
  ticketNumber?: string
  subject?: string
  description?: string
  status?: string
  statusType?: string
  priority?: string
  category?: string
  subCategory?: string
  classification?: string
  channel?: string
  departmentId?: string
  createdTime?: string
  /** Present on `GET /tickets/{id}` only — the list projection omits it. */
  modifiedTime?: string
  closedTime?: string | null
  customerResponseTime?: string | null
  threadCount?: string
  commentCount?: string
  resolution?: string | null
  webUrl?: string
  isTrashed?: boolean
}

interface ZohoDeskConversationEntry {
  id: string
  type?: string
  summary?: string
  content?: string
  contentType?: string
  createdTime?: string
  commentedTime?: string
  visibility?: string
  isPublic?: boolean
  direction?: string
  channel?: string
  author?: { name?: string; email?: string; type?: string }
  commenter?: { name?: string; email?: string; type?: string }
}

interface ZohoDeskThreadDetail {
  id: string
  content?: string
  plainText?: string
  contentType?: string
  summary?: string
}

interface ZohoDeskOrganization {
  id: string
  companyName?: string
}

/**
 * Resolves the Zoho Desk REST base (`{deskHost}/api/v1`) for the configured data
 * center. The host comes from a closed map, never from user input, so the OAuth
 * token can only reach a Zoho-owned origin.
 *
 * @throws {Error} when the configured data center is not recognized.
 */
function resolveApiBase(sourceConfig: Record<string, unknown>): string {
  const raw = typeof sourceConfig.dataCenter === 'string' ? sourceConfig.dataCenter.trim() : ''
  const key = (raw || DEFAULT_ZOHO_DESK_DATA_CENTER) as ZohoDeskDataCenter
  const host = ZOHO_DESK_DATA_CENTER_BASES[key]
  if (!host) {
    throw new Error(`Unsupported Zoho Desk data center: ${raw}`)
  }
  return `${host}/api/v1`
}

/**
 * Reads the required organization ID from the connector config.
 *
 * @throws {Error} when it is missing.
 */
function requireOrgId(sourceConfig: Record<string, unknown>): string {
  const orgId = typeof sourceConfig.orgId === 'string' ? sourceConfig.orgId.trim() : ''
  if (!orgId) {
    throw new Error('Organization ID is required')
  }
  return orgId
}

/**
 * Reads an optional positive integer cap, falling back to `fallback` when unset
 * and throwing when it is present but not a positive number.
 */
function resolveMax(value: unknown, fallback: number, label: string): number {
  if (value === undefined || value === null || value === '') return fallback
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error(`${label} must be a positive number`)
  }
  return Math.floor(parsed)
}

/** Carries the HTTP status so callers can tell a deleted record from a fault. */
class ZohoDeskApiError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
    this.name = 'ZohoDeskApiError'
  }
}

/**
 * Performs an authenticated GET against the Zoho Desk API.
 *
 * Zoho answers an empty collection with `204 No Content` (which has no JSON body),
 * so that case is normalized to an empty object rather than left to throw.
 */
async function deskGet(
  url: string,
  accessToken: string,
  orgId: string | undefined,
  retryOptions?: Parameters<typeof fetchWithRetry>[2]
): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = {
    Authorization: `Zoho-oauthtoken ${accessToken}`,
    Accept: 'application/json',
  }
  if (orgId) headers.orgId = orgId

  const response = await fetchWithRetry(url, { method: 'GET', headers }, retryOptions)

  if (response.status === 204) return {}

  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>

  if (!response.ok) {
    const message =
      typeof body.message === 'string' && body.message.trim()
        ? body.message
        : typeof body.errorCode === 'string' && body.errorCode.trim()
          ? body.errorCode
          : `Zoho Desk API HTTP error: ${response.status}`
    throw new ZohoDeskApiError(response.status, message)
  }

  return body
}

/** Reads the `data` array Zoho wraps every list response in. */
function readDataArray<T>(body: Record<string, unknown>): T[] {
  return Array.isArray(body.data) ? (body.data as T[]) : []
}

/** Matches a value that carries HTML markup rather than plain prose. */
const HTML_MARKUP_PATTERN = /<[a-z][\s\S]*>/i

/**
 * Renders a Zoho content value as plain text. Zoho spells the HTML discriminator
 * both as `html` (comments) and `text/html` (threads), so both are matched.
 *
 * A ticket's `description` and `resolution` carry no content-type at all while
 * still holding rich text, so an undeclared value is sniffed for markup and
 * stripped only when tags are actually present — a genuinely plain body is
 * never mangled.
 */
function toPlainText(content: string | undefined, contentType: string | undefined): string {
  if (!content) return ''
  const normalized = contentType?.trim().toLowerCase() ?? ''
  if (normalized) {
    const isHtml = normalized === 'html' || normalized.startsWith('text/html')
    return isHtml ? htmlToPlainText(content) : content
  }
  return HTML_MARKUP_PATTERN.test(content) ? htmlToPlainText(content) : content
}

/**
 * Drains a Zoho `from`/`limit` paginated list into a single array, stopping at
 * `max`.
 *
 * The final page asks only for the records still needed, so the walk never pulls
 * more than `max`. When the cap is reached on an exactly-full page the source may
 * or may not hold more, and Zoho's list responses carry no "has more" marker, so
 * one extra single-record probe settles it.
 *
 * @param probeForMore when false the cap is treated as non-truncating. Only for
 * callers that ignore `truncated` (per-ticket conversation folding), so they do
 * not pay for the probe.
 * @returns the collected items and whether the source still had more to give
 * when the cap stopped the walk — the caller must surface that as
 * `syncContext.listingCapped` so the sync engine does not hard-delete every
 * document past the cap.
 */
async function drainPaginated<T>(
  fetchPage: (from: number, limit: number) => Promise<T[]>,
  pageSize: number,
  max: number,
  probeForMore = true
): Promise<{ items: T[]; truncated: boolean }> {
  const items: T[] = []
  let from = 0

  while (items.length < max) {
    // Zoho refuses `from >= 5000` outright, so the walk stops one page short of
    // the ceiling and declares itself capped rather than throwing a 422.
    if (from > MAX_LIST_OFFSET) return { items, truncated: true }
    const limit = Math.min(pageSize, max - items.length)
    const page = await fetchPage(from, limit)
    if (page.length === 0) return { items, truncated: false }

    items.push(...page)

    // A short page means the source is exhausted, which is exactly the case the
    // sync engine must be allowed to reconcile deletions against.
    if (page.length < limit) return { items, truncated: false }
    from += page.length
  }

  if (!probeForMore) return { items, truncated: false }
  if (from > MAX_LIST_OFFSET) return { items, truncated: true }

  const probe = await fetchPage(from, 1)
  return { items, truncated: probe.length > 0 }
}

/** Lists Help Center articles, newest-first-stable on `createdTime`. */
async function fetchArticles(
  apiBase: string,
  accessToken: string,
  orgId: string,
  options: { status?: string; categoryId?: string; max: number }
): Promise<{ items: ZohoDeskArticleSummary[]; truncated: boolean }> {
  return drainPaginated<ZohoDeskArticleSummary>(
    async (from, limit) => {
      const query = new URLSearchParams({
        from: String(from),
        limit: String(limit),
        /**
         * Newest first. Zoho treats a bare field as ascending and a `-` prefix as
         * descending, so `createdTime` would fill the cap with the oldest records
         * and leave recent tickets and articles permanently unreachable — the cap
         * sets `listingCapped`, which stops that stale tail from ever reconciling
         * away. Sorting on createdTime rather than modifiedTime keeps the order
         * stable across pages; edits would otherwise reshuffle rows mid-walk.
         */
        sortBy: '-createdTime',
      })
      if (options.status && options.status !== 'all') query.set('status', options.status)
      if (options.categoryId) query.set('categoryId', options.categoryId)
      const body = await deskGet(`${apiBase}/articles?${query.toString()}`, accessToken, orgId)
      return readDataArray<ZohoDeskArticleSummary>(body)
    },
    ARTICLES_PAGE_SIZE,
    options.max
  )
}

/** Lists tickets, optionally filtered by status and department. */
async function fetchTickets(
  apiBase: string,
  accessToken: string,
  orgId: string,
  options: { status?: string; departmentIds: string[]; max: number }
): Promise<{ items: ZohoDeskTicket[]; truncated: boolean }> {
  return drainPaginated<ZohoDeskTicket>(
    async (from, limit) => {
      const query = new URLSearchParams({
        from: String(from),
        limit: String(limit),
        /**
         * Newest first. Zoho treats a bare field as ascending and a `-` prefix as
         * descending, so `createdTime` would fill the cap with the oldest records
         * and leave recent tickets and articles permanently unreachable — the cap
         * sets `listingCapped`, which stops that stale tail from ever reconciling
         * away. Sorting on createdTime rather than modifiedTime keeps the order
         * stable across pages; edits would otherwise reshuffle rows mid-walk.
         */
        sortBy: '-createdTime',
      })
      if (options.status) query.set('status', options.status)
      if (options.departmentIds.length > 0) {
        query.set('departmentIds', options.departmentIds.join(','))
      }
      const body = await deskGet(`${apiBase}/tickets?${query.toString()}`, accessToken, orgId)
      return readDataArray<ZohoDeskTicket>(body)
    },
    TICKETS_PAGE_SIZE,
    options.max
  )
}

/** Lists the threads and comments recorded on a ticket, oldest page first. */
async function fetchConversations(
  apiBase: string,
  accessToken: string,
  orgId: string,
  ticketId: string
): Promise<ZohoDeskConversationEntry[]> {
  const { items } = await drainPaginated<ZohoDeskConversationEntry>(
    async (from, limit) => {
      const query = new URLSearchParams({ from: String(from), limit: String(limit) })
      const body = await deskGet(
        `${apiBase}/tickets/${encodeURIComponent(ticketId)}/conversations?${query.toString()}`,
        accessToken,
        orgId
      )
      return readDataArray<ZohoDeskConversationEntry>(body)
    },
    CONVERSATIONS_PAGE_SIZE,
    MAX_CONVERSATION_ENTRIES,
    false
  )
  return items
}

/**
 * Fetches a thread's full body. `/conversations` returns only a truncated
 * `summary` for threads, so the message text has to be read per thread.
 */
async function fetchThread(
  apiBase: string,
  accessToken: string,
  orgId: string,
  ticketId: string,
  threadId: string
): Promise<ZohoDeskThreadDetail | null> {
  const body = await deskGet(
    `${apiBase}/tickets/${encodeURIComponent(ticketId)}/threads/${encodeURIComponent(threadId)}?include=plainText`,
    accessToken,
    orgId
  )
  // double-cast-allowed: deskGet returns an untyped JSON record; `id` is checked above
  return typeof body.id === 'string' ? (body as unknown as ZohoDeskThreadDetail) : null
}

/** Formats one conversation entry as a labelled block of plain text. */
function formatConversationEntry(
  entry: ZohoDeskConversationEntry,
  hydrated: ZohoDeskThreadDetail | null
): string {
  const isComment = entry.type === 'comment'
  const person = isComment ? entry.commenter : entry.author
  const timestamp = entry.commentedTime || entry.createdTime || ''
  const visibility = isComment
    ? entry.isPublic === false
      ? 'Internal'
      : 'Public'
    : entry.visibility || 'public'

  const body = hydrated
    ? hydrated.plainText?.trim() ||
      toPlainText(hydrated.content, hydrated.contentType) ||
      hydrated.summary ||
      ''
    : toPlainText(entry.content, entry.contentType) || entry.summary || ''

  const label = isComment ? 'Comment' : 'Thread'
  const author = person?.name || person?.email || 'Unknown'
  return `\n[${timestamp}] ${label} (${visibility}) — ${author}:\n${body}`
}

/** Folds a ticket and its conversation into one plain-text document body. */
function formatTicketContent(ticket: ZohoDeskTicket, conversation: string[]): string {
  const parts: string[] = []

  if (ticket.subject) parts.push(`Subject: ${ticket.subject}`)
  if (ticket.status) parts.push(`Status: ${ticket.status}`)
  if (ticket.priority) parts.push(`Priority: ${ticket.priority}`)
  if (ticket.classification) parts.push(`Classification: ${ticket.classification}`)
  if (ticket.category) parts.push(`Category: ${ticket.category}`)
  if (ticket.channel) parts.push(`Channel: ${ticket.channel}`)
  if (ticket.createdTime) parts.push(`Created: ${ticket.createdTime}`)
  if (ticket.modifiedTime) parts.push(`Updated: ${ticket.modifiedTime}`)

  if (ticket.description) {
    parts.push('')
    parts.push('--- Description ---')
    parts.push(toPlainText(ticket.description, undefined))
  }

  // The agent's resolution note is the single most reusable answer on a ticket,
  // and `GET /tickets/{id}` is the only place it is returned.
  if (ticket.resolution) {
    parts.push('')
    parts.push('--- Resolution ---')
    parts.push(toPlainText(ticket.resolution, undefined))
  }

  if (conversation.length > 0) {
    parts.push('')
    parts.push('--- Conversation ---')
    parts.push(...conversation)
  }

  return parts.join('\n')
}

/**
 * Metadata-only change indicator for a ticket.
 *
 * Deliberately excludes `modifiedTime`: Zoho returns it on `GET /tickets/{id}`
 * but NOT on the `GET /tickets` list projection, so mixing it in would make the
 * listing stub and the hydrated document hash differently and re-index every
 * ticket on every sync forever. Every field below appears on both responses.
 *
 * `createdTime` alone would never move, so the fields that do track activity ride
 * along: the conversation counters, the workflow state, and the last customer
 * response.
 */
function ticketContentHash(ticket: ZohoDeskTicket): string {
  return [
    'zoho_desk:ticket',
    ticket.id,
    ticket.createdTime ?? '',
    ticket.threadCount ?? '',
    ticket.commentCount ?? '',
    ticket.status ?? '',
    ticket.priority ?? '',
    ticket.closedTime ?? '',
    ticket.customerResponseTime ?? '',
  ].join(':')
}

/**
 * Builds the deferred stub for a ticket. Content is resolved lazily in
 * `getDocument` because the conversation needs one call per ticket (plus one per
 * thread), which would exhaust the listing pass's time budget.
 */
function ticketToStub(ticket: ZohoDeskTicket): ExternalDocument {
  const number = ticket.ticketNumber ? `#${ticket.ticketNumber}` : ticket.id
  return {
    externalId: `ticket-${ticket.id}`,
    title: `Ticket ${number}: ${ticket.subject || 'Untitled'}`,
    content: '',
    contentDeferred: true,
    mimeType: 'text/plain',
    sourceUrl: ticket.webUrl,
    contentHash: ticketContentHash(ticket),
    metadata: {
      type: 'ticket',
      ticketId: ticket.id,
      ticketNumber: ticket.ticketNumber,
      status: ticket.status,
      priority: ticket.priority,
      category: ticket.category,
      departmentId: ticket.departmentId,
      commentCount: Number(ticket.commentCount ?? 0),
      updatedAt: ticket.modifiedTime || ticket.createdTime,
      createdAt: ticket.createdTime,
    },
  }
}

/** Metadata-only change indicator for an article. */
function articleContentHash(article: ZohoDeskArticleSummary): string {
  return `zoho_desk:article:${article.id}:${article.modifiedTime || article.createdTime || ''}`
}

/**
 * Builds the deferred stub for an article. The article list projection carries
 * only a truncated `summary`; the full `answer` body comes from the per-article
 * endpoint, so content is deferred.
 */
function articleToStub(article: ZohoDeskArticleSummary): ExternalDocument {
  return {
    externalId: `article-${article.id}`,
    title: article.title || 'Untitled',
    content: '',
    contentDeferred: true,
    mimeType: 'text/plain',
    sourceUrl: article.portalUrl || article.webUrl,
    contentHash: articleContentHash(article),
    metadata: {
      type: 'article',
      articleId: article.id,
      status: article.status,
      locale: article.locale,
      category: article.category?.name,
      categoryId: article.categoryId || article.category?.id,
      tags: article.tags,
      updatedAt: article.modifiedTime || article.createdTime,
      createdAt: article.createdTime,
    },
  }
}

export const zohoDeskConnector: ConnectorConfig = {
  ...zohoDeskConnectorMeta,

  listDocuments: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    _cursor?: string,
    syncContext?: Record<string, unknown>
  ): Promise<ExternalDocumentList> => {
    const apiBase = resolveApiBase(sourceConfig)
    const orgId = requireOrgId(sourceConfig)
    const contentType = (sourceConfig.contentType as string) || 'both'

    const documents: ExternalDocument[] = []
    let truncated = false

    if (contentType === 'articles' || contentType === 'both') {
      const max = resolveMax(sourceConfig.maxArticles, DEFAULT_MAX_ARTICLES, 'Max articles')
      const articleStatus =
        typeof sourceConfig.articleStatus === 'string'
          ? sourceConfig.articleStatus.trim()
          : undefined
      const categoryId =
        typeof sourceConfig.articleCategoryId === 'string'
          ? sourceConfig.articleCategoryId.trim()
          : undefined

      const articles = await fetchArticles(apiBase, accessToken, orgId, {
        status: articleStatus,
        categoryId: categoryId || undefined,
        max,
      })
      logger.info(`Fetched ${articles.items.length} articles from Zoho Desk`, { orgId })
      truncated = truncated || articles.truncated

      for (const article of articles.items) {
        if (article.isTrashed) continue
        documents.push(articleToStub(article))
      }
    }

    if (contentType === 'tickets' || contentType === 'both') {
      const max = resolveMax(sourceConfig.maxTickets, DEFAULT_MAX_TICKETS, 'Max tickets')
      const ticketStatus =
        typeof sourceConfig.ticketStatus === 'string' ? sourceConfig.ticketStatus.trim() : undefined

      const tickets = await fetchTickets(apiBase, accessToken, orgId, {
        status: ticketStatus || undefined,
        departmentIds: parseMultiValue(sourceConfig.departmentIds),
        max,
      })
      logger.info(`Fetched ${tickets.items.length} tickets from Zoho Desk`, { orgId })
      truncated = truncated || tickets.truncated

      for (const ticket of tickets.items) {
        if (ticket.isTrashed) continue
        documents.push(ticketToStub(ticket))
      }
    }

    // A capped listing is not the full source set. Without this flag the sync
    // engine treats every document past the cap as deleted and removes it.
    if (truncated && syncContext) {
      syncContext.listingCapped = true
    }

    return { documents, hasMore: false }
  },

  getDocument: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    externalId: string
  ): Promise<ExternalDocument | null> => {
    try {
      const apiBase = resolveApiBase(sourceConfig)
      const orgId = requireOrgId(sourceConfig)

      if (externalId.startsWith('article-')) {
        const articleId = externalId.slice('article-'.length)
        const body = await deskGet(
          `${apiBase}/articles/${encodeURIComponent(articleId)}`,
          accessToken,
          orgId
        )
        if (typeof body.id !== 'string') return null
        // double-cast-allowed: deskGet returns an untyped JSON record; `id` is checked above
        const article = body as unknown as ZohoDeskArticleDetail
        if (article.isTrashed) return null

        const content = htmlToPlainText(article.answer || '')
        if (!content.trim()) return null

        return { ...articleToStub(article), content, contentDeferred: false }
      }

      if (externalId.startsWith('ticket-')) {
        const ticketId = externalId.slice('ticket-'.length)
        const body = await deskGet(
          `${apiBase}/tickets/${encodeURIComponent(ticketId)}`,
          accessToken,
          orgId
        )
        if (typeof body.id !== 'string') return null
        // double-cast-allowed: deskGet returns an untyped JSON record; `id` is checked above
        const ticket = body as unknown as ZohoDeskTicket
        if (ticket.isTrashed) return null

        const entries = await fetchConversations(apiBase, accessToken, orgId, ticketId)
        if (entries.length >= MAX_CONVERSATION_ENTRIES) {
          logger.warn('Zoho Desk ticket conversation truncated at the entry cap', {
            ticketId,
            cap: MAX_CONVERSATION_ENTRIES,
          })
        }
        const threadIds = entries
          .filter((entry) => entry.type === 'thread')
          .slice(0, MAX_HYDRATED_THREADS)
          .map((entry) => entry.id)
        const hydratedById = new Map<string, ZohoDeskThreadDetail>()

        for (let i = 0; i < threadIds.length; i += THREAD_FETCH_CONCURRENCY) {
          await Promise.all(
            threadIds.slice(i, i + THREAD_FETCH_CONCURRENCY).map(async (threadId) => {
              try {
                const detail = await fetchThread(apiBase, accessToken, orgId, ticketId, threadId)
                if (detail) hydratedById.set(threadId, detail)
              } catch (error) {
                logger.warn('Failed to fetch Zoho Desk thread body; using summary', {
                  ticketId,
                  threadId,
                  error: getErrorMessage(error),
                })
              }
            })
          )
        }

        const blocks = entries.map((entry) =>
          formatConversationEntry(
            entry,
            entry.type === 'thread' ? (hydratedById.get(entry.id) ?? null) : null
          )
        )

        const content = formatTicketContent(ticket, blocks)
        if (!content.trim()) return null

        return { ...ticketToStub(ticket), content, contentDeferred: false }
      }

      return null
    } catch (error) {
      /**
       * Only a deleted record (404/410) resolves to `null`. Every other failure is
       * rethrown so the sync engine records a visible failed document instead of
       * dropping it from the run with no counter and no error log.
       */
      if (error instanceof ZohoDeskApiError && (error.status === 404 || error.status === 410)) {
        return null
      }
      throw error
    }
  },

  validateConfig: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>
  ): Promise<{ valid: boolean; error?: string }> => {
    const orgId = typeof sourceConfig.orgId === 'string' ? sourceConfig.orgId.trim() : ''
    if (!orgId) {
      return { valid: false, error: 'Organization ID is required' }
    }

    const dataCenter =
      typeof sourceConfig.dataCenter === 'string' ? sourceConfig.dataCenter.trim() : ''
    if (!dataCenter || !(dataCenter in ZOHO_DESK_DATA_CENTER_BASES)) {
      return { valid: false, error: 'A supported Zoho Desk data center is required' }
    }

    const contentType =
      typeof sourceConfig.contentType === 'string' ? sourceConfig.contentType.trim() : ''
    if (!contentType) {
      return { valid: false, error: 'Content type is required' }
    }

    try {
      resolveMax(sourceConfig.maxTickets, DEFAULT_MAX_TICKETS, 'Max tickets')
      resolveMax(sourceConfig.maxArticles, DEFAULT_MAX_ARTICLES, 'Max articles')
    } catch (error) {
      return { valid: false, error: getErrorMessage(error) }
    }

    try {
      const apiBase = resolveApiBase(sourceConfig)
      // `/organizations` is the one Desk endpoint that is not org-scoped, so it
      // verifies the token and the data center, and confirms the configured
      // organization is actually one this credential can reach.
      const body = await deskGet(
        `${apiBase}/organizations`,
        accessToken,
        undefined,
        VALIDATE_RETRY_OPTIONS
      )
      const organizations = readDataArray<ZohoDeskOrganization>(body)
      if (!organizations.some((organization) => String(organization.id) === orgId)) {
        return {
          valid: false,
          error: `Organization ${orgId} is not accessible with this credential in the selected data center`,
        }
      }
      return { valid: true }
    } catch (error) {
      return { valid: false, error: getErrorMessage(error, 'Failed to validate configuration') }
    }
  },

  mapTags: (metadata: Record<string, unknown>): Record<string, unknown> => {
    const result: Record<string, unknown> = {}

    if (typeof metadata.type === 'string') result.contentType = metadata.type
    if (typeof metadata.status === 'string') result.status = metadata.status
    if (typeof metadata.priority === 'string') result.priority = metadata.priority
    if (typeof metadata.category === 'string') result.category = metadata.category

    const tags = joinTagArray(metadata.tags)
    if (tags) result.tags = tags

    const updatedAt = parseTagDate(metadata.updatedAt)
    if (updatedAt) result.updatedAt = updatedAt

    if (metadata.commentCount != null) {
      const commentCount = Number(metadata.commentCount)
      if (!Number.isNaN(commentCount)) result.commentCount = commentCount
    }

    return result
  },
}
