import { createLogger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import { isPlainRecord } from '@sim/utils/object'
import { mapWithConcurrency } from '@/lib/core/utils/concurrency'
import { fetchWithRetry, VALIDATE_RETRY_OPTIONS } from '@/lib/knowledge/documents/utils'
import { DEFAULT_MAX_THREADS, gmailConnectorMeta } from '@/connectors/gmail/meta'
import type { ConnectorConfig, ExternalDocument, ExternalDocumentList } from '@/connectors/types'
import {
  BoundedLines,
  CONNECTOR_TEXT_DOCUMENT_MAX_BYTES,
  htmlToPlainText,
  isPerMemberListing,
  joinTagArray,
  memberDocumentId,
  parseDefaultedUnlimitedSafeInteger,
  parseMultiValue,
  parseTagDate,
  sourceDocumentId,
} from '@/connectors/utils'

const logger = createLogger('GmailConnector')

const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me'
const THREADS_PER_PAGE = 100

class GmailApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(`${message}: ${status}`)
    this.name = 'GmailApiError'
  }
}

interface GmailHeader {
  name: string
  value: string
}

interface GmailMessagePart {
  mimeType?: string
  filename?: string
  body?: { data?: string; size?: number }
  parts?: GmailMessagePart[]
  headers?: GmailHeader[]
}

interface GmailMessage {
  id: string
  threadId: string
  internalDate?: string
  payload?: GmailMessagePart
  labelIds?: string[]
  snippet?: string
}

interface GmailThread {
  id: string
  historyId?: string
  messages?: GmailMessage[]
  snippet?: string
}

interface GmailThreadList {
  threads: GmailThread[]
  nextPageToken?: string
}

/** Legacy cursors contain only Gmail's raw page token. */
function parseListingCursor(cursor?: string): { pageToken?: string; searchQuery?: string } {
  if (!cursor) return {}
  try {
    const parsed: unknown = JSON.parse(cursor)
    if (
      isPlainRecord(parsed) &&
      typeof parsed.pageToken === 'string' &&
      parsed.pageToken.length > 0 &&
      typeof parsed.searchQuery === 'string'
    ) {
      return { pageToken: parsed.pageToken, searchQuery: parsed.searchQuery }
    }
  } catch {
    return { pageToken: cursor }
  }
  return { pageToken: cursor }
}

function isThreadMetadata(value: unknown): value is GmailThread {
  return (
    isPlainRecord(value) &&
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    (value.historyId === undefined ||
      (typeof value.historyId === 'string' && value.historyId.length > 0)) &&
    (value.snippet === undefined || typeof value.snippet === 'string')
  )
}

function parseThreadList(value: unknown): GmailThreadList {
  if (
    !isPlainRecord(value) ||
    (value.threads !== undefined &&
      (!Array.isArray(value.threads) || !value.threads.every(isThreadMetadata))) ||
    (value.nextPageToken !== undefined &&
      (typeof value.nextPageToken !== 'string' || value.nextPageToken.length === 0))
  ) {
    throw new Error('Gmail returned malformed thread listing metadata')
  }
  return {
    threads: (value.threads ?? []) as GmailThread[],
    nextPageToken: value.nextPageToken as string | undefined,
  }
}

interface GmailLabel {
  id: string
  name: string
  type?: string
}

const LABEL_CACHE_KEY = '_gmailLabelCache'

interface GmailLabelIndex {
  /** Label id (e.g. `INBOX`, `Label_7`) to display name. */
  byId: Record<string, string>
  /** Lowercased display name to label id. */
  idByLowerName: Record<string, string>
}

const EMPTY_LABEL_INDEX: GmailLabelIndex = { byId: {}, idByLowerName: {} }

function buildLabelIndex(labels: GmailLabel[]): GmailLabelIndex {
  const index: GmailLabelIndex = { byId: {}, idByLowerName: {} }
  for (const label of labels) {
    if (!label?.id || typeof label.name !== 'string') continue
    index.byId[label.id] = label.name
    index.idByLowerName[label.name.toLowerCase()] = label.id
  }
  return index
}

/**
 * Fetches `users.labels.list` once and caches the result on `syncContext` so it is
 * shared across pages and across every deferred `getDocument` hydration. A failed
 * fetch resolves to `null` and that failure is cached too, so a persistently
 * failing labels call cannot turn into a per-document API call.
 *
 * Callers must distinguish `null` from an empty index: label tagging degrades to
 * raw ids, but query building cannot — see `listDocuments`.
 */
async function getLabelIndex(
  accessToken: string,
  syncContext?: Record<string, unknown>
): Promise<GmailLabelIndex | null> {
  if (syncContext && LABEL_CACHE_KEY in syncContext) {
    return syncContext[LABEL_CACHE_KEY] as GmailLabelIndex | null
  }

  let index: GmailLabelIndex | null = null
  try {
    const response = await fetchWithRetry(`${GMAIL_API_BASE}/labels`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    })

    if (response.status === 401) {
      throw new GmailApiError('Failed to fetch Gmail labels', response.status)
    }
    if (response.ok) {
      const data: unknown = await response.json()
      if (!isPlainRecord(data) || !Array.isArray(data.labels)) {
        throw new Error('Gmail returned malformed labels')
      }
      index = buildLabelIndex(data.labels as GmailLabel[])
    } else {
      logger.warn('Failed to fetch Gmail labels', { status: response.status })
    }
  } catch (error) {
    if (error instanceof GmailApiError && error.status === 401) throw error
    logger.warn('Failed to fetch Gmail labels', { error: toError(error).message })
  }

  if (syncContext) syncContext[LABEL_CACHE_KEY] = index
  return index
}

/**
 * Resolves a configured label value to the display name the `label:` search
 * operator matches on. The `gmail.labels` selector stores label **ids**
 * (`Label_7`), while the search operator only understands label **names**, so an
 * id is translated through the label index. Values that are already names (typed
 * into the advanced input) pass through unchanged.
 */
function resolveLabelName(value: string, index: GmailLabelIndex): string {
  return index.byId[value] ?? value
}

/**
 * Formats a single Gmail label name for use in a `label:` operator.
 * Gmail search syntax accepts quoted strings for labels containing spaces;
 * unquoted label tokens have spaces replaced with hyphens.
 */
function formatLabelToken(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) return ''
  if (/\s/.test(trimmed)) {
    const escaped = trimmed.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
    return `label:"${escaped}"`
  }
  return `label:${trimmed}`
}

/**
 * Builds a Gmail search query string from the source config.
 * Combines the user's custom query with the label and date range filters.
 * When multiple labels are provided, they are OR-joined: `(label:A OR label:B)`.
 */
function buildSearchQuery(
  sourceConfig: Record<string, unknown>,
  labelIndex: GmailLabelIndex = EMPTY_LABEL_INDEX
): string {
  const parts: string[] = []

  const labelNames = parseMultiValue(sourceConfig.label).map((value) =>
    resolveLabelName(value, labelIndex)
  )
  if (labelNames.length === 1) {
    const token = formatLabelToken(labelNames[0])
    if (token) parts.push(token)
  } else if (labelNames.length > 1) {
    const tokens = labelNames.map(formatLabelToken).filter(Boolean)
    if (tokens.length === 1) {
      parts.push(tokens[0])
    } else if (tokens.length > 1) {
      parts.push(`(${tokens.join(' OR ')})`)
    }
  }

  const dateRange = (sourceConfig.dateRange as string) || 'all'
  const now = new Date()
  switch (dateRange) {
    case '7d':
      parts.push(`after:${formatGmailDate(daysAgo(now, 7))}`)
      break
    case '30d':
      parts.push(`after:${formatGmailDate(daysAgo(now, 30))}`)
      break
    case '90d':
      parts.push(`after:${formatGmailDate(daysAgo(now, 90))}`)
      break
    case '6m':
      parts.push(`after:${formatGmailDate(daysAgo(now, 180))}`)
      break
    case '1y':
      parts.push(`after:${formatGmailDate(daysAgo(now, 365))}`)
      break
  }

  const excludePromotions = sourceConfig.excludePromotions !== 'false'
  if (excludePromotions) {
    parts.push('-category:promotions')
  }

  const excludeSocial = sourceConfig.excludeSocial !== 'false'
  if (excludeSocial) {
    parts.push('-category:social')
  }

  const customQuery = sourceConfig.query as string | undefined
  const trimmedCustom = customQuery?.trim()
  if (trimmedCustom) {
    /**
     * Wrap the user-supplied query in parentheses whenever it contains an OR
     * so it's AND-joined as a single clause with the preceding label / category
     * / date filters. Always wrap (rather than try to detect existing outer
     * parens) because a regex like /^\(.*\)$/ misclassifies inputs such as
     * `(from:alice) OR (from:bob)` where the parens don't bracket the whole
     * expression. Double-wrapping is a no-op in Gmail search syntax.
     */
    const needsGroup = /\bOR\b/i.test(trimmedCustom)
    parts.push(needsGroup ? `(${trimmedCustom})` : trimmedCustom)
  }

  return parts.join(' ')
}

function daysAgo(now: Date, days: number): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
}

function formatGmailDate(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}/${m}/${d}`
}

/**
 * Decodes base64url-encoded content from the Gmail API.
 * Uses Buffer to correctly handle multi-byte UTF-8 characters.
 */
function decodeBase64Url(data: string): string {
  return Buffer.from(data, 'base64url').toString('utf-8')
}

/**
 * True when a MIME part is an attachment rather than a body part, so a `.txt` or
 * `.html` attachment is never mistaken for the message body.
 *
 * `MessagePart.filename` is documented as "the filename of the attachment. Only
 * present if this message part represents an attachment" — i.e. absent on body
 * parts. In practice Gmail also emits `""` there, so the truthiness test covers
 * both the documented and the observed shape.
 */
function isAttachmentPart(part: GmailMessagePart): boolean {
  return Boolean(part.filename)
}

/**
 * Extracts the plain text body from a Gmail message payload.
 * Prefers text/plain, falls back to text/html with tag stripping, and recurses
 * through nested multiparts (e.g. a multipart/alternative inside a multipart/mixed).
 */
function extractBody(part: GmailMessagePart): string {
  if (isAttachmentPart(part)) return ''

  if (part.mimeType === 'text/plain' && part.body?.data) {
    return decodeBase64Url(part.body.data)
  }

  if (part.parts) {
    const children = part.parts.filter((child) => !isAttachmentPart(child))
    for (const child of children) {
      if (child.mimeType === 'text/plain' && child.body?.data) {
        return decodeBase64Url(child.body.data)
      }
    }
    for (const child of children) {
      if (child.mimeType === 'text/html' && child.body?.data) {
        return htmlToPlainText(decodeBase64Url(child.body.data))
      }
    }
    for (const child of children) {
      const result = extractBody(child)
      if (result) return result
    }
  }

  if (part.mimeType === 'text/html' && part.body?.data) {
    return htmlToPlainText(decodeBase64Url(part.body.data))
  }

  return ''
}

/**
 * Gets a header value from a Gmail message payload.
 */
function getHeader(payload: GmailMessagePart | undefined, name: string): string | undefined {
  if (!payload?.headers) return undefined
  const header = payload.headers.find((h) => h.name.toLowerCase() === name.toLowerCase())
  return header?.value
}

/**
 * Formats a thread's messages into a single document string.
 */
function formatThread(thread: GmailThread): {
  content: string
  subject: string
  metadata: Record<string, unknown>
} {
  const messages = thread.messages || []
  if (messages.length === 0) {
    return { content: '', subject: 'Untitled Thread', metadata: {} }
  }

  const firstMessage = messages[0]
  const lastMessage = messages[messages.length - 1]
  const subject = getHeader(firstMessage.payload, 'Subject') || 'No Subject'
  const from = getHeader(firstMessage.payload, 'From') || 'Unknown'
  const to = getHeader(firstMessage.payload, 'To') || ''
  /**
   * Gmail applies labels per message, not per thread — the thread's label set is
   * the union across its messages. Reading only `messages[0]` drops labels that
   * were applied to a later reply (and are exactly what a `label:` filter matched).
   */
  const labelIdSet = new Set<string>()
  for (const msg of messages) {
    for (const id of msg.labelIds ?? []) labelIdSet.add(id)
  }
  const labelIds = [...labelIdSet]

  const lines = new BoundedLines()
  lines.push(`Subject: ${subject}`, `From: ${from}`)
  if (to) lines.push(`To: ${to}`)
  lines.push(`Messages: ${messages.length}`, '')

  for (const msg of messages) {
    const msgFrom = getHeader(msg.payload, 'From') || 'Unknown'
    const msgDate = getHeader(msg.payload, 'Date') || ''
    const body = msg.payload ? extractBody(msg.payload) : ''

    if (!lines.push(`--- ${msgFrom} (${msgDate}) ---`, body.trim(), '')) break
  }

  const firstDate = firstMessage.internalDate
    ? new Date(Number(firstMessage.internalDate)).toISOString()
    : undefined
  const lastDate = lastMessage.internalDate
    ? new Date(Number(lastMessage.internalDate)).toISOString()
    : undefined

  return {
    content: lines.join().trim(),
    subject,
    metadata: {
      from,
      to,
      subject,
      messageCount: messages.length,
      labelIds,
      firstMessageDate: firstDate,
      lastMessageDate: lastDate,
    },
  }
}

/**
 * Minimal reads recover missing listing revisions without downloading message bodies.
 */
async function fetchThread(
  accessToken: string,
  threadId: string,
  format: 'full' | 'minimal' = 'full'
): Promise<GmailThread | null> {
  const params = new URLSearchParams({ format })
  if (format === 'minimal') params.set('fields', 'id,historyId,snippet')
  const url = `${GMAIL_API_BASE}/threads/${encodeURIComponent(threadId)}?${params}`

  const response = await fetchWithRetry(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    if (response.status === 404) return null
    throw new GmailApiError(`Failed to fetch thread ${threadId}`, response.status)
  }

  const thread: unknown = await response.json()
  if (
    !isThreadMetadata(thread) ||
    thread.id !== threadId ||
    !thread.historyId ||
    (format === 'full' && !Array.isArray(thread.messages))
  ) {
    throw new Error('Gmail returned malformed thread metadata')
  }
  return thread
}

/**
 * Resolves label IDs to human-readable label names using the shared label index.
 */
async function resolveLabelNames(
  accessToken: string,
  labelIds: string[],
  syncContext?: Record<string, unknown>
): Promise<string[]> {
  const index = await getLabelIndex(accessToken, syncContext)
  return labelIds
    .map((id) => index?.byId[id] || id)
    .filter((name) => !name.startsWith('CATEGORY_') && name !== 'UNREAD')
}

/**
 * Creates a lightweight document stub from a thread list entry.
 * Uses metadata-based contentHash for change detection without downloading content.
 */
function threadToStub(
  thread: GmailThread,
  syncContext?: Record<string, unknown>
): ExternalDocument {
  return {
    externalId: memberDocumentId(thread.id, syncContext),
    title: thread.snippet || 'Untitled Thread',
    content: '',
    contentDeferred: true,
    estimatedBytes: CONNECTOR_TEXT_DOCUMENT_MAX_BYTES,
    mimeType: 'text/plain',
    sourceUrl: threadUrl(thread.id),
    contentHash: `gmail:${thread.id}:${thread.historyId}`,
    metadata: {},
  }
}

/**
 * Deep link to a thread. `#all` is used rather than `#inbox` because a synced
 * thread may be archived or live only under a user label, where an `#inbox`
 * fragment resolves to nothing.
 */
function threadUrl(threadId: string): string {
  return `https://mail.google.com/mail/u/0/#all/${threadId}`
}

export const gmailConnector: ConnectorConfig = {
  ...gmailConnectorMeta,

  isCredentialInvalidError: (error) => error instanceof GmailApiError && error.status === 401,

  listDocuments: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    cursor?: string,
    syncContext?: Record<string, unknown>
  ): Promise<ExternalDocumentList> => {
    const { pageToken, searchQuery: savedSearchQuery } = parseListingCursor(cursor)
    let searchQuery = savedSearchQuery
    const configuredLabels = parseMultiValue(sourceConfig.label)
    if (
      isPerMemberListing(syncContext) &&
      configuredLabels.some((label) => label.startsWith('Label_'))
    ) {
      throw new Error(
        'Use Gmail label names instead of account-specific label IDs for member accounts'
      )
    }
    if (searchQuery === undefined) {
      let labelIndex = EMPTY_LABEL_INDEX
      if (configuredLabels.length > 0) {
        /**
         * Unresolved label IDs can silently match nothing, which a complete
         * listing would misinterpret as deleted documents. Fail the sync instead.
         */
        const resolved = await getLabelIndex(accessToken, syncContext)
        if (!resolved) {
          throw new Error(
            'Failed to fetch Gmail labels; cannot resolve the configured label filter'
          )
        }
        labelIndex = resolved
      }
      searchQuery = buildSearchQuery(sourceConfig, labelIndex)
    }
    /** A blank field keeps the default cap; an explicit 0 (a per-member sync) means unlimited. */
    const maxThreads = parseDefaultedUnlimitedSafeInteger(
      sourceConfig.maxThreads,
      DEFAULT_MAX_THREADS,
      'maxThreads must be a non-negative integer'
    )

    const totalFetched = (syncContext?.totalThreadsFetched as number) ?? 0
    if (maxThreads > 0 && totalFetched >= maxThreads) {
      return { documents: [], hasMore: false }
    }

    const pageSize =
      maxThreads > 0 ? Math.min(THREADS_PER_PAGE, maxThreads - totalFetched) : THREADS_PER_PAGE

    const queryParams = new URLSearchParams({
      maxResults: String(pageSize),
      fields: 'threads(id,historyId,snippet),nextPageToken',
    })

    if (searchQuery) {
      queryParams.set('q', searchQuery)
    }

    if (pageToken) {
      queryParams.set('pageToken', pageToken)
    }

    const url = `${GMAIL_API_BASE}/threads?${queryParams.toString()}`

    logger.info('Listing Gmail threads', {
      maxThreads,
    })

    const response = await fetchWithRetry(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    })

    if (!response.ok) {
      logger.error('Failed to list Gmail threads', { status: response.status })
      throw new GmailApiError('Failed to list Gmail threads', response.status)
    }

    const { threads, nextPageToken } = parseThreadList(await response.json())
    const stubs = await mapWithConcurrency(threads, 5, async (thread) => {
      const metadata = thread.historyId
        ? thread
        : await fetchThread(accessToken, thread.id, 'minimal')
      return metadata ? threadToStub(metadata, syncContext) : null
    })
    const documents = stubs.filter((stub): stub is ExternalDocument => stub !== null)

    const newTotal = totalFetched + threads.length
    if (syncContext) syncContext.totalThreadsFetched = newTotal

    const hitLimit = maxThreads > 0 && newTotal >= maxThreads

    /**
     * Only a cap that actually truncates a longer listing blocks deletion
     * reconciliation. Reaching the cap exactly as the source runs out
     * (`nextPageToken` absent) is genuine exhaustion, and flagging it would
     * permanently prevent deleted threads from being reconciled.
     */
    if (hitLimit && nextPageToken && syncContext) syncContext.listingCapped = true

    /**
     * `nextPageToken` is the only exhaustion signal. `users.threads.list` documents
     * the token as the way to reach the next page but never guarantees a non-empty
     * `threads` array alongside one, so an empty page is not treated as the end:
     * doing so would report a complete-but-empty listing and let the sync engine
     * hard-delete every previously stored thread.
     */
    return {
      documents,
      /** Relative dates and resolved label names must stay fixed across checkpoint resumes. */
      nextCursor:
        !hitLimit && nextPageToken
          ? JSON.stringify({ pageToken: nextPageToken, searchQuery })
          : undefined,
      hasMore: hitLimit ? false : Boolean(nextPageToken),
    }
  },

  getDocument: async (
    accessToken: string,
    _sourceConfig: Record<string, unknown>,
    externalId: string,
    syncContext?: Record<string, unknown>
  ): Promise<ExternalDocument | null> => {
    const threadId = sourceDocumentId(externalId, syncContext)
    if (!threadId) return null
    const thread = await fetchThread(accessToken, threadId)
    if (!thread) return null

    const { content, subject, metadata } = formatThread(thread)
    if (!content.trim()) return null

    const labelIds = (metadata.labelIds as string[]) || []
    metadata.labels = await resolveLabelNames(accessToken, labelIds, syncContext)

    return {
      ...threadToStub(thread, syncContext),
      title: subject,
      content,
      contentDeferred: false,
      metadata,
    }
  },

  validateConfig: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>
  ): Promise<{ valid: boolean; error?: string }> => {
    /** The same parser the sync uses, so a value that saves is a value that syncs. */
    try {
      parseDefaultedUnlimitedSafeInteger(
        sourceConfig.maxThreads,
        DEFAULT_MAX_THREADS,
        'Max threads must be a non-negative whole number'
      )
    } catch (error) {
      return { valid: false, error: getErrorMessage(error) }
    }

    try {
      const profileUrl = `${GMAIL_API_BASE}/profile`
      const profileResponse = await fetchWithRetry(
        profileUrl,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/json',
          },
        },
        VALIDATE_RETRY_OPTIONS
      )

      if (!profileResponse.ok) {
        return { valid: false, error: `Failed to access Gmail: ${profileResponse.status}` }
      }

      /**
       * Labels may arrive as ids (from the `gmail.labels` selector) or as names
       * (typed into the advanced input), so both forms are accepted here and the
       * same index is what `buildSearchQuery` resolves ids through.
       */
      const configuredLabels = parseMultiValue(sourceConfig.label)
      let labelIndex = EMPTY_LABEL_INDEX
      if (configuredLabels.length > 0) {
        const labelsUrl = `${GMAIL_API_BASE}/labels`
        const labelsResponse = await fetchWithRetry(
          labelsUrl,
          {
            method: 'GET',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              Accept: 'application/json',
            },
          },
          VALIDATE_RETRY_OPTIONS
        )

        if (!labelsResponse.ok) {
          return { valid: false, error: 'Failed to fetch labels' }
        }

        const labelsData = await labelsResponse.json()
        const labels = (labelsData.labels || []) as GmailLabel[]
        labelIndex = buildLabelIndex(labels)
        const missing = configuredLabels.filter(
          (value) => !labelIndex.byId[value] && !labelIndex.idByLowerName[value.toLowerCase()]
        )

        if (missing.length > 0) {
          return {
            valid: false,
            error: `Label(s) not found: ${missing.join(', ')}. Available labels: ${labels
              .filter(
                (l) =>
                  l.type !== 'system' ||
                  ['INBOX', 'IMPORTANT', 'STARRED', 'SENT', 'DRAFT'].includes(l.id)
              )
              .map((l) => l.name)
              .slice(0, 15)
              .join(', ')}`,
          }
        }
      }

      const query = sourceConfig.query as string | undefined
      if (query?.trim()) {
        const searchQuery = buildSearchQuery(sourceConfig, labelIndex)
        const testUrl = `${GMAIL_API_BASE}/threads?q=${encodeURIComponent(searchQuery)}&maxResults=1`
        const testResponse = await fetchWithRetry(
          testUrl,
          {
            method: 'GET',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              Accept: 'application/json',
            },
          },
          VALIDATE_RETRY_OPTIONS
        )

        if (!testResponse.ok) {
          return { valid: false, error: 'Invalid search query. Check Gmail search syntax.' }
        }
      }

      return { valid: true }
    } catch (error) {
      const message = getErrorMessage(error, 'Failed to validate configuration')
      return { valid: false, error: message }
    }
  },

  mapTags: (metadata: Record<string, unknown>): Record<string, unknown> => {
    const result: Record<string, unknown> = {}

    if (typeof metadata.from === 'string') {
      result.from = metadata.from
    }

    const labels = joinTagArray(metadata.labels)
    if (labels) {
      result.labels = labels
    }

    if (typeof metadata.messageCount === 'number') {
      result.messageCount = metadata.messageCount
    }

    const lastMessageDate = parseTagDate(metadata.lastMessageDate)
    if (lastMessageDate) {
      result.lastMessageDate = lastMessageDate
    }

    return result
  },
}
