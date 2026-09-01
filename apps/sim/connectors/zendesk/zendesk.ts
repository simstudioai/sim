import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { secureFetchWithRetry } from '@/lib/knowledge/documents/secure-fetch.server'
import { VALIDATE_RETRY_OPTIONS } from '@/lib/knowledge/documents/utils'
import type { ConnectorConfig, ExternalDocument, ExternalDocumentList } from '@/connectors/types'
import { htmlToPlainText, joinTagArray, parseTagDate } from '@/connectors/utils'
import { DEFAULT_MAX_TICKETS, zendeskConnectorMeta } from '@/connectors/zendesk/meta'

const logger = createLogger('ZendeskConnector')

/** Zendesk caps cursor and offset page sizes at 100 records on these endpoints. */
const PAGE_SIZE = 100

/**
 * The Search API returns at most 1,000 results per query and answers 422 for any
 * page beyond that depth, so ticket listings that go through it are hard-capped.
 * @see https://developer.zendesk.com/api-reference/ticketing/ticket-management/search/
 */
const SEARCH_API_RESULT_CAP = 1000

/**
 * Safety valves on the unbounded cursor loops. Articles have no user-facing cap,
 * so a runaway or looping cursor must not pull an unbounded corpus into memory.
 */
const MAX_ARTICLE_PAGES = 500
const MAX_COMMENT_PAGES = 100

const VALID_TICKET_STATUSES = new Set(['new', 'open', 'pending', 'hold', 'solved', 'closed'])

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

/** Result of a paged fetch, carrying whether the source still had records left. */
interface PagedResult<T> {
  items: T[]
  /** True when records matching the request still exist beyond what was returned. */
  capped: boolean
}

/**
 * Strict Zendesk subdomain label: a single DNS label of lowercase letters,
 * digits, and hyphens (not leading/trailing). Rejects anything that could
 * smuggle a scheme, host, path, port, or fragment into the base URL.
 */
const SUBDOMAIN_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/

/**
 * Validates and normalizes a Zendesk subdomain.
 *
 * @throws {Error} when the subdomain is missing or not a valid DNS label.
 */
function normalizeSubdomain(subdomain: string): string {
  const normalized = subdomain.trim().toLowerCase()
  if (!SUBDOMAIN_PATTERN.test(normalized)) {
    throw new Error('Invalid Zendesk subdomain')
  }
  return normalized
}

/**
 * Builds the base URL for a Zendesk subdomain. The subdomain is validated to a
 * strict DNS label so it cannot be used to forge requests to arbitrary hosts.
 */
export function buildBaseUrl(subdomain: string): string {
  return `https://${normalizeSubdomain(subdomain)}.zendesk.com`
}

/**
 * Accepts a paginated `links.next` / `next_page` URL only when it stays on the
 * validated Zendesk base URL, so a mutated or spoofed response body cannot walk
 * the sync onto an arbitrary host.
 */
export function sameOriginNextUrl(nextUrl: unknown, baseUrl: string): string | null {
  if (typeof nextUrl !== 'string' || nextUrl.length === 0) return null
  return nextUrl.startsWith(`${baseUrl}/`) ? nextUrl : null
}

/** Carries the HTTP status so callers can tell a deleted record from a fault. */
class ZendeskApiError extends Error {
  constructor(readonly status: number) {
    super(`Zendesk API HTTP error: ${status}`)
    this.name = 'ZendeskApiError'
  }
}

/**
 * Makes an authenticated GET request to the Zendesk API using API-token Basic
 * auth (`{email}/token:{api_token}`).
 */
async function zendeskApiGet(
  url: string,
  accessToken: string,
  sourceConfig: Record<string, unknown>,
  retryOptions?: Parameters<typeof secureFetchWithRetry>[2]
): Promise<Record<string, unknown>> {
  const email = ((sourceConfig.email as string) ?? '').trim()
  if (!email) {
    throw new Error('Email is required for Zendesk API authentication')
  }

  const response = await secureFetchWithRetry(
    url,
    {
      profile: 'configuredEndpoint',
      method: 'GET',
      headers: {
        Authorization: `Basic ${Buffer.from(`${email}/token:${accessToken}`, 'utf8').toString('base64')}`,
        Accept: 'application/json',
      },
    },
    retryOptions
  )

  if (!response.ok) {
    throw new ZendeskApiError(response.status)
  }

  return (await response.json()) as Record<string, unknown>
}

/**
 * One step of a paginated walk.
 *
 * `url === null` alone does not mean the listing ended: `truncated` separates a
 * source that reported no further records from one that still advertised records
 * but whose continuation link could not be followed. Collapsing the two into a
 * bare `null` reports a partial listing as a complete one, and the sync engine
 * then hard-deletes every stored document past the last page it managed to read.
 */
interface PageStep {
  /** The next page to request, or null when the walk cannot continue. */
  url: string | null
  /**
   * True when the walk stopped without the source ever saying it was done: the
   * response still advertised more records, but its continuation link was
   * missing, malformed, or rejected by the same-origin guard.
   */
  truncated: boolean
}

/** A walk that ended because the source said there was nothing left. */
const PAGE_WALK_EXHAUSTED: PageStep = { url: null, truncated: false }

/**
 * Reads the cursor-pagination continuation from a Zendesk response. Offset
 * pagination is limited to the first 100 pages / 10,000 records and answers 400
 * past that depth, so every unbounded listing uses cursor pagination instead.
 *
 * `meta.has_more === true` is the only signal that continues the walk. Zendesk
 * emits `links.next` even on the last page, so `meta` — not the link — is what
 * decides whether to keep paginating; following a link on a response with no
 * `meta` would never terminate, and this walk has no page-depth valve.
 *
 * How the stop is *reported* is what distinguishes the two ways it can happen:
 * `has_more === false` is exhaustion, while a missing or malformed `meta` (an
 * interstitial, a truncated body, a proxy error page) is truncation. Reading the
 * latter as a drained cursor hands every unlisted document to deletion
 * reconciliation.
 *
 * A `links.next` the same-origin guard refuses — a host-mapped Help Center or
 * brand host emits one that is not on `https://{subdomain}.zendesk.com` — also
 * stops the walk as truncated, never as exhausted. The guard itself is correct
 * and stays; only the reason the walk stopped is reported honestly.
 * @see https://developer.zendesk.com/api-reference/introduction/pagination/
 */
function readCursorNext(data: Record<string, unknown>, baseUrl: string): PageStep {
  const meta = data.meta as { has_more?: unknown } | undefined
  if (meta?.has_more !== true) return { url: null, truncated: meta?.has_more !== false }
  const links = data.links as { next?: string } | undefined
  const url = sameOriginNextUrl(links?.next, baseUrl)
  return { url, truncated: url === null }
}

/**
 * Reads the offset-pagination continuation used by the Search API, which carries
 * `next_page` (null on the last page) instead of a `meta`/`links` envelope.
 *
 * An absent `next_page` is exhaustion. Search responses carry both keys, and the
 * caller's `count`-vs-returned check already caps every case where a missing
 * `next_page` could hide records, so treating its absence as truncation would
 * only add a cap nothing needs. A present link the same-origin guard refuses is
 * truncation.
 */
function readOffsetNext(data: Record<string, unknown>, baseUrl: string): PageStep {
  const nextPage = data.next_page
  if (nextPage == null) return PAGE_WALK_EXHAUSTED
  const url = sameOriginNextUrl(nextPage, baseUrl)
  return { url, truncated: url === null }
}

/**
 * Fetches Help Center articles via cursor pagination.
 *
 * `capped` is true only when the walk stopped with articles still remaining —
 * the page safety valve tripping, or a continuation link that could not be
 * followed. A cursor drained to `has_more: false` is a complete listing.
 */
async function fetchArticles(
  baseUrl: string,
  accessToken: string,
  sourceConfig: Record<string, unknown>,
  locale?: string
): Promise<PagedResult<ZendeskArticle>> {
  const items: ZendeskArticle[] = []
  const localePath = locale ? `/${encodeURIComponent(locale)}` : ''
  const params = new URLSearchParams({ 'page[size]': String(PAGE_SIZE) })
  let url: string | null = `${baseUrl}/api/v2/help_center${localePath}/articles.json?${params}`
  let pages = 0

  while (url) {
    const data = await zendeskApiGet(url, accessToken, sourceConfig)
    items.push(...((data.articles as ZendeskArticle[]) || []))
    pages += 1

    const step = readCursorNext(data, baseUrl)
    if (step.truncated) {
      logger.warn(
        'Zendesk article listing stopped at an unusable continuation link with more articles remaining; listing is incomplete.',
        { pages, articles: items.length }
      )
      return { items, capped: true }
    }

    url = step.url
    if (url && pages >= MAX_ARTICLE_PAGES) {
      logger.warn(
        `Zendesk article listing stopped at the ${MAX_ARTICLE_PAGES}-page safety valve with more articles remaining; listing is incomplete.`
      )
      return { items, capped: true }
    }
  }

  return { items, capped: false }
}

/**
 * Fetches tickets, honouring the configured cap.
 *
 * Without a status filter this uses cursor pagination on the tickets endpoint
 * (no depth cap). With a status filter it must use the Search API, which is
 * offset-only and hard-capped at 1,000 results.
 *
 * `capped` is true only when tickets matching the request still exist beyond
 * what is returned, so a genuinely exhausted source still reconciles deletions.
 */
async function fetchTickets(
  baseUrl: string,
  accessToken: string,
  sourceConfig: Record<string, unknown>,
  statusFilter: string | undefined,
  limit: number
): Promise<PagedResult<ZendeskTicket>> {
  const useSearch = VALID_TICKET_STATUSES.has(statusFilter ?? '')

  if (statusFilter && statusFilter !== 'all' && !useSearch) {
    logger.warn(
      `Invalid Zendesk statusFilter "${statusFilter}"; falling back to all tickets. Valid values: ${[...VALID_TICKET_STATUSES].join(', ')}.`
    )
  }

  return useSearch
    ? fetchTicketsViaSearch(baseUrl, accessToken, sourceConfig, statusFilter as string, limit)
    : fetchTicketsViaCursor(baseUrl, accessToken, sourceConfig, limit)
}

/**
 * Lists tickets newest-updated first via cursor pagination, which has no page-depth
 * limit. `sort=-updated_at` is one of the three sort keys the tickets endpoint accepts
 * under cursor pagination (`updated_at`, `id`, `status`, each optionally `-` prefixed),
 * and it is what makes the `limit` truncation keep the most recently touched tickets
 * rather than an arbitrary slice by id.
 */
async function fetchTicketsViaCursor(
  baseUrl: string,
  accessToken: string,
  sourceConfig: Record<string, unknown>,
  limit: number
): Promise<PagedResult<ZendeskTicket>> {
  const items: ZendeskTicket[] = []
  const params = new URLSearchParams({ 'page[size]': String(PAGE_SIZE), sort: '-updated_at' })
  let url: string | null = `${baseUrl}/api/v2/tickets.json?${params}`
  let sourceHasMore = false
  let truncated = false

  while (url) {
    const data = await zendeskApiGet(url, accessToken, sourceConfig)
    items.push(...((data.tickets as ZendeskTicket[]) || []))

    const step = readCursorNext(data, baseUrl)
    if (step.truncated) {
      logger.warn(
        'Zendesk ticket listing stopped at an unusable continuation link with more tickets remaining; listing is incomplete.',
        { tickets: items.length }
      )
      truncated = true
      break
    }

    url = step.url
    sourceHasMore = url !== null
    if (items.length >= limit) break
  }

  /**
   * `truncated` caps regardless of how few tickets came back: the walk stopped
   * short of a source that still had records, so the unread remainder must not
   * be read as deleted.
   */
  const capped = truncated || items.length > limit || (items.length >= limit && sourceHasMore)
  return { items: items.slice(0, limit), capped }
}

async function fetchTicketsViaSearch(
  baseUrl: string,
  accessToken: string,
  sourceConfig: Record<string, unknown>,
  statusFilter: string,
  limit: number
): Promise<PagedResult<ZendeskTicket>> {
  const effectiveLimit = Math.min(limit, SEARCH_API_RESULT_CAP)
  if (limit > SEARCH_API_RESULT_CAP) {
    logger.warn(
      `Zendesk Search API caps at ${SEARCH_API_RESULT_CAP} results; requested limit ${limit} is truncated. Remove the status filter to use the unbounded tickets endpoint.`
    )
  }

  const items: ZendeskTicket[] = []
  const params = new URLSearchParams({
    query: `type:ticket status:${statusFilter}`,
    sort_by: 'updated_at',
    sort_order: 'desc',
    per_page: String(PAGE_SIZE),
  })
  let url: string | null = `${baseUrl}/api/v2/search.json?${params}`
  let sourceHasMore = false
  let truncated = false
  let totalMatches: number | null = null

  while (url) {
    const data = await zendeskApiGet(url, accessToken, sourceConfig)
    items.push(...((data.results as ZendeskTicket[]) || []))
    if (typeof data.count === 'number') totalMatches = data.count

    const step = readOffsetNext(data, baseUrl)
    if (step.truncated) {
      logger.warn(
        'Zendesk ticket search stopped at an unusable continuation link with more results remaining; listing is incomplete.',
        { tickets: items.length }
      )
      truncated = true
      break
    }

    url = step.url
    sourceHasMore = url !== null
    if (items.length >= effectiveLimit) break
  }

  const returned = Math.min(items.length, effectiveLimit)
  const capped =
    truncated ||
    sourceHasMore ||
    items.length > effectiveLimit ||
    (totalMatches !== null && totalMatches > returned)

  return { items: items.slice(0, effectiveLimit), capped }
}

/**
 * Fetches comments for a ticket via cursor pagination, bounded by a page
 * safety valve so a pathological ticket cannot exhaust memory.
 */
async function fetchTicketComments(
  baseUrl: string,
  accessToken: string,
  sourceConfig: Record<string, unknown>,
  ticketId: number
): Promise<ZendeskComment[]> {
  const allComments: ZendeskComment[] = []
  const params = new URLSearchParams({ 'page[size]': String(PAGE_SIZE) })
  let url: string | null = `${baseUrl}/api/v2/tickets/${ticketId}/comments.json?${params}`
  let pages = 0

  while (url) {
    const data = await zendeskApiGet(url, accessToken, sourceConfig)
    allComments.push(...((data.comments as ZendeskComment[]) || []))
    pages += 1

    const step = readCursorNext(data, baseUrl)
    if (step.truncated) {
      logger.warn('Zendesk ticket comment listing stopped at an unusable continuation link', {
        ticketId,
        comments: allComments.length,
      })
      break
    }

    url = step.url
    if (url && pages >= MAX_COMMENT_PAGES) {
      logger.warn('Zendesk ticket comment listing truncated at the page safety valve', {
        ticketId,
        comments: allComments.length,
      })
      break
    }
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
  if (ticket.tags?.length) {
    parts.push(`Tags: ${ticket.tags.join(', ')}`)
  }
  parts.push('')
  parts.push('--- Description ---')
  parts.push(htmlToPlainText(ticket.description || ''))

  if (comments.length > 0) {
    parts.push('')
    parts.push('--- Comments ---')
    for (const comment of comments) {
      const visibility = comment.public ? 'Public' : 'Internal'
      parts.push(`\n[${comment.created_at}] (${visibility}) Author ${comment.author_id}:`)
      parts.push(htmlToPlainText(comment.html_body || comment.body || ''))
    }
  }

  return parts.join('\n')
}

/**
 * Converts an article to an ExternalDocument with inline content.
 * Articles return body inline from the list API so no deferral is needed.
 */
function articleToDocument(article: ZendeskArticle, baseUrl: string): ExternalDocument {
  const content = htmlToPlainText(article.body || '')

  return {
    externalId: `article-${article.id}`,
    title: article.title || 'Untitled',
    content,
    mimeType: 'text/plain',
    sourceUrl: article.html_url || `${baseUrl}/hc/articles/${article.id}`,
    contentHash: `zendesk:article:${article.id}:${article.updated_at}`,
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
 * Creates a deferred stub for a ticket. Content is not fetched here because
 * each ticket requires a separate comments API call. Full content is fetched
 * lazily via getDocument only for new/changed documents.
 */
function ticketToStub(ticket: ZendeskTicket, baseUrl: string): ExternalDocument {
  return {
    externalId: `ticket-${ticket.id}`,
    title: `Ticket #${ticket.id}: ${ticket.subject || 'Untitled'}`,
    content: '',
    contentDeferred: true,
    mimeType: 'text/plain',
    sourceUrl: `${baseUrl}/agent/tickets/${ticket.id}`,
    contentHash: `zendesk:ticket:${ticket.id}:${ticket.updated_at}`,
    metadata: {
      type: 'ticket',
      ticketId: ticket.id,
      status: ticket.status,
      priority: ticket.priority,
      tags: ticket.tags,
      createdAt: ticket.created_at,
      updatedAt: ticket.updated_at,
    },
  }
}

/**
 * Converts a ticket (with comments) to a full ExternalDocument. Used by
 * getDocument to resolve deferred ticket stubs; the identity fields and
 * `contentHash` are taken from the same stub so a hydrated document never
 * looks changed relative to its listing entry.
 */
function ticketToDocument(
  ticket: ZendeskTicket,
  comments: ZendeskComment[],
  baseUrl: string
): ExternalDocument {
  const stub = ticketToStub(ticket, baseUrl)

  return {
    ...stub,
    content: formatTicketContent(ticket, comments),
    contentDeferred: false,
    metadata: {
      ...stub.metadata,
      commentCount: comments.length,
    },
  }
}

export const zendeskConnector: ConnectorConfig = {
  ...zendeskConnectorMeta,

  listDocuments: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    _cursor?: string,
    syncContext?: Record<string, unknown>
  ): Promise<ExternalDocumentList> => {
    const subdomain = (sourceConfig.subdomain as string)?.trim()
    if (!subdomain) {
      throw new Error('Subdomain is required')
    }
    const baseUrl = buildBaseUrl(subdomain)

    const email = (sourceConfig.email as string)?.trim()
    if (!email) {
      throw new Error('Email is required')
    }

    const contentType = (sourceConfig.contentType as string) || 'both'
    const ticketStatus = sourceConfig.ticketStatus as string | undefined
    const locale = (sourceConfig.locale as string)?.trim() || undefined
    const parsedMax = Number(sourceConfig.maxTickets)
    const maxTickets =
      Number.isFinite(parsedMax) && parsedMax > 0 ? Math.floor(parsedMax) : DEFAULT_MAX_TICKETS

    const documents: ExternalDocument[] = []
    let listingCapped = false

    if (contentType === 'articles' || contentType === 'both') {
      logger.info('Fetching Zendesk Help Center articles', { subdomain, locale })
      const articles = await fetchArticles(baseUrl, accessToken, sourceConfig, locale)
      logger.info(`Fetched ${articles.items.length} articles from Zendesk`)
      listingCapped ||= articles.capped

      for (const article of articles.items) {
        if (!article.body?.trim()) continue
        documents.push(articleToDocument(article, baseUrl))
      }
    }

    if (contentType === 'tickets' || contentType === 'both') {
      logger.info('Fetching Zendesk support tickets', { subdomain, ticketStatus, maxTickets })
      const tickets = await fetchTickets(
        baseUrl,
        accessToken,
        sourceConfig,
        ticketStatus,
        maxTickets
      )
      logger.info(`Fetched ${tickets.items.length} tickets from Zendesk`)
      listingCapped ||= tickets.capped

      for (const ticket of tickets.items) {
        documents.push(ticketToStub(ticket, baseUrl))
      }
    }

    /**
     * The sync engine hard-deletes stored documents absent from a full listing.
     * Flag the listing as capped whenever the source still held matching records
     * beyond what was returned, so the truncated remainder is not deleted.
     */
    if (listingCapped && syncContext) {
      syncContext.listingCapped = true
      logger.warn('Zendesk listing was capped; deletion reconciliation will be suppressed', {
        subdomain,
        documents: documents.length,
      })
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
    /**
     * A misconfigured source is a failure, not an absent document. Returning
     * `null` reads as documented absence, which on an `add` drops the document
     * with no counter and no log. `listDocuments` throws on the same condition.
     */
    if (!subdomain) throw new Error('Subdomain is required')

    try {
      const baseUrl = buildBaseUrl(subdomain)

      if (externalId.startsWith('article-')) {
        const articleId = externalId.slice('article-'.length)
        const url = `${baseUrl}/api/v2/help_center/articles/${encodeURIComponent(articleId)}.json`
        const data = await zendeskApiGet(url, accessToken, sourceConfig)
        const article = data.article as ZendeskArticle
        if (!article) return null
        return articleToDocument(article, baseUrl)
      }

      if (externalId.startsWith('ticket-')) {
        const ticketId = Number(externalId.slice('ticket-'.length))
        if (!Number.isInteger(ticketId) || ticketId <= 0) return null
        const url = `${baseUrl}/api/v2/tickets/${ticketId}.json`
        const data = await zendeskApiGet(url, accessToken, sourceConfig)
        const ticket = data.ticket as ZendeskTicket
        if (!ticket) return null
        const comments = await fetchTicketComments(baseUrl, accessToken, sourceConfig, ticketId)
        return ticketToDocument(ticket, comments, baseUrl)
      }

      return null
    } catch (error) {
      /**
       * A deleted record (404) is the only documented absence and resolves to
       * `null`. Every other failure is rethrown so the sync engine records a
       * visible failed document instead of dropping it from the run with no
       * counter — and, for an already-indexed ticket, keeps it as
       * last-known-good rather than exposing it to deletion reconciliation.
       */
      if (error instanceof ZendeskApiError && error.status === 404) {
        return null
      }
      throw toError(error)
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
      return { valid: false, error: toError(error).message || 'Failed to validate configuration' }
    }
  },

  mapTags: (metadata: Record<string, unknown>): Record<string, unknown> => {
    const result: Record<string, unknown> = {}

    if (typeof metadata.type === 'string') {
      result.contentType = metadata.type
    }

    if (typeof metadata.status === 'string') {
      result.status = metadata.status
    }

    if (typeof metadata.priority === 'string') {
      result.priority = metadata.priority
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
