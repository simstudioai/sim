import { createLogger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import { isPlainRecord } from '@sim/utils/object'
import { mapWithConcurrency } from '@/lib/core/utils/concurrency'
import { isPayloadSizeLimitError, readResponseJsonWithLimit } from '@/lib/core/utils/stream-limits'
import { fetchWithRetry, VALIDATE_RETRY_OPTIONS } from '@/lib/knowledge/documents/utils'
import { DEFAULT_MAX_THREADS, gmailConnectorMeta } from '@/connectors/gmail/meta'
import {
  getGoogleWorkspaceDocument,
  InvalidGoogleWorkspaceCursor,
  listGoogleWorkspaceDocuments,
  validateGoogleWorkspaceConfig,
} from '@/connectors/google-workspace/company-crawl'
import type {
  ConnectorConfig,
  ExternalChange,
  ExternalChangeList,
  ExternalDocument,
  ExternalDocumentList,
} from '@/connectors/types'
import {
  BoundedLines,
  CONNECTOR_TEXT_DOCUMENT_MAX_BYTES,
  ConnectorFileTooLargeError,
  htmlToPlainText,
  isPerMemberListing,
  joinTagArray,
  markSkipped,
  memberDocumentId,
  parseDefaultedUnlimitedSafeInteger,
  parseMultiValue,
  parseOptionalUnlimitedSafeInteger,
  parseTagDate,
  sizeLimitSkipReason,
  sourceDocumentId,
} from '@/connectors/utils'

const logger = createLogger('GmailConnector')

const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me'
const THREADS_PER_PAGE = 100
const BODY_RESPONSE_ENVELOPE_BYTES = 1024
/** Bounds base64 bodies, alternative MIME parts, and headers before parsing the thread JSON. */
const MAX_THREAD_RESPONSE_BYTES = 32 * 1024 * 1024
const MAX_METADATA_RESPONSE_BYTES = 8 * 1024 * 1024

/** History records that can move a thread into or out of the configured scope. */
const HISTORY_TYPES = ['messageAdded', 'messageDeleted', 'labelAdded', 'labelRemoved'] as const
const HISTORY_PAGE_SIZE = 500
/** Changed threads re-read per history page before their stubs are returned. */
const CHANGED_THREAD_CONCURRENCY = 5
/** Gmail's thread listing omits these unless `includeSpamTrash` is set; the feed must agree. */
const HIDDEN_LABEL_IDS = new Set(['SPAM', 'TRASH'])

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
  body?: { data?: string; size?: number; attachmentId?: string }
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

interface GmailBodyContext {
  accessToken: string
  remainingBytes: number
  signal?: AbortSignal
}

function isConfirmedResponseOverflow(error: unknown, label: string): boolean {
  return (
    isPayloadSizeLimitError(error) &&
    error.label === label &&
    error.observedBytes !== undefined &&
    error.observedBytes > error.maxBytes
  )
}

/** Legacy cursors contain only Gmail's raw page token. */
function parseListingCursor(cursor?: string): { pageToken?: string; searchQuery?: string } {
  if (!cursor) return {}
  try {
    const parsed: unknown = JSON.parse(cursor)
    if (
      isPlainRecord(parsed) &&
      (parsed.pageToken === undefined ||
        (typeof parsed.pageToken === 'string' && parsed.pageToken.length > 0)) &&
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
      (!Array.isArray(value.threads) ||
        value.threads.length > THREADS_PER_PAGE ||
        !value.threads.every(isThreadMetadata))) ||
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

async function readLabels(response: Response): Promise<GmailLabel[]> {
  const data = await readResponseJsonWithLimit(response, {
    maxBytes: MAX_METADATA_RESPONSE_BYTES,
    label: 'Gmail labels',
  })
  if (
    !isPlainRecord(data) ||
    !Array.isArray(data.labels) ||
    !data.labels.every(
      (label): label is GmailLabel =>
        isPlainRecord(label) &&
        typeof label.id === 'string' &&
        label.id.length > 0 &&
        typeof label.name === 'string' &&
        (label.type === undefined || typeof label.type === 'string')
    )
  )
    throw new Error('Gmail returned malformed labels')
  return data.labels
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
  const signal = syncContext?.signal instanceof AbortSignal ? syncContext.signal : undefined
  signal?.throwIfAborted()
  if (syncContext && LABEL_CACHE_KEY in syncContext) {
    return syncContext[LABEL_CACHE_KEY] as GmailLabelIndex | null
  }

  let index: GmailLabelIndex | null = null
  try {
    const response = await fetchWithRetry(`${GMAIL_API_BASE}/labels`, {
      method: 'GET',
      signal,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    })

    if (response.status === 401) {
      throw new GmailApiError('Failed to fetch Gmail labels', response.status)
    }
    if (response.ok) {
      index = buildLabelIndex(await readLabels(response))
    } else {
      logger.warn('Failed to fetch Gmail labels', { status: response.status })
    }
  } catch (error) {
    signal?.throwIfAborted()
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

  const after = dateRangeStart(sourceConfig, new Date())
  if (after) parts.push(`after:${formatGmailDate(after)}`)

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

const DATE_RANGE_DAYS = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
  '6m': 180,
  '1y': 365,
} as const

function isBoundedDateRange(value: unknown): value is keyof typeof DATE_RANGE_DAYS {
  return typeof value === 'string' && Object.hasOwn(DATE_RANGE_DAYS, value)
}

/** The earliest message date the configured range admits, or undefined for all time. */
function dateRangeStart(sourceConfig: Record<string, unknown>, now: Date): Date | undefined {
  const range = sourceConfig.dateRange
  return isBoundedDateRange(range) ? daysAgo(now, DATE_RANGE_DAYS[range]) : undefined
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
function decodeBase64Url(data: string, context: GmailBodyContext): string {
  const bytes = Buffer.byteLength(data, 'base64url')
  if (bytes > context.remainingBytes) {
    throw new ConnectorFileTooLargeError(CONNECTOR_TEXT_DOCUMENT_MAX_BYTES)
  }
  context.remainingBytes -= bytes
  return Buffer.from(data, 'base64url').toString('utf-8')
}

/** Fetches separately stored MIME body data without downloading file attachments. */
async function readMessageBody(
  part: GmailMessagePart,
  messageId: string,
  context: GmailBodyContext
): Promise<string> {
  context.signal?.throwIfAborted()
  const body = part.body
  if (!body) return ''
  if (body.size !== undefined && body.size > context.remainingBytes) {
    throw new ConnectorFileTooLargeError(CONNECTOR_TEXT_DOCUMENT_MAX_BYTES)
  }
  if (!body.attachmentId) return body.data ? decodeBase64Url(body.data, context) : ''

  const params = new URLSearchParams({ fields: 'data,size' })
  const response = await fetchWithRetry(
    `${GMAIL_API_BASE}/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(body.attachmentId)}?${params}`,
    {
      method: 'GET',
      signal: context.signal,
      headers: { Authorization: `Bearer ${context.accessToken}`, Accept: 'application/json' },
    }
  )
  if (!response.ok) {
    throw new GmailApiError('Failed to fetch Gmail message body', response.status)
  }

  let fetchedBody: unknown
  try {
    fetchedBody = await readResponseJsonWithLimit(response, {
      /** Bound base64 expansion before parsing, including when Gmail omits the part's size. */
      maxBytes: Math.ceil(context.remainingBytes / 3) * 4 + BODY_RESPONSE_ENVELOPE_BYTES,
      label: 'Gmail message body',
    })
  } catch (error) {
    if (isConfirmedResponseOverflow(error, 'Gmail message body')) {
      throw new ConnectorFileTooLargeError(CONNECTOR_TEXT_DOCUMENT_MAX_BYTES)
    }
    throw error
  }
  if (
    !isPlainRecord(fetchedBody) ||
    typeof fetchedBody.data !== 'string' ||
    !/^[A-Za-z0-9_-]*={0,2}$/.test(fetchedBody.data) ||
    fetchedBody.data.replace(/=+$/, '').length % 4 === 1 ||
    typeof fetchedBody.size !== 'number' ||
    !Number.isSafeInteger(fetchedBody.size) ||
    fetchedBody.size < 0 ||
    Buffer.byteLength(fetchedBody.data, 'base64url') !== fetchedBody.size
  ) {
    throw new Error('Gmail returned malformed message body data')
  }
  return decodeBase64Url(fetchedBody.data, context)
}

function hasMessageBody(part: GmailMessagePart): boolean {
  return Boolean(part.body?.data || part.body?.attachmentId)
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
async function extractBody(
  part: GmailMessagePart,
  messageId: string,
  context: GmailBodyContext
): Promise<string> {
  if (isAttachmentPart(part)) return ''

  if (part.mimeType === 'text/plain' && hasMessageBody(part)) {
    return readMessageBody(part, messageId, context)
  }

  if (part.parts) {
    const children = part.parts.filter((child) => !isAttachmentPart(child))
    for (const child of children) {
      if (child.mimeType === 'text/plain' && hasMessageBody(child)) {
        return readMessageBody(child, messageId, context)
      }
    }
    for (const child of children) {
      if (child.mimeType === 'text/html' && hasMessageBody(child)) {
        return htmlToPlainText(await readMessageBody(child, messageId, context))
      }
    }
    for (const child of children) {
      const result = await extractBody(child, messageId, context)
      if (result) return result
    }
  }

  if (part.mimeType === 'text/html' && hasMessageBody(part)) {
    return htmlToPlainText(await readMessageBody(part, messageId, context))
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
async function formatThread(
  thread: GmailThread,
  accessToken: string,
  signal?: AbortSignal
): Promise<{
  content: string
  subject: string
  metadata: Record<string, unknown>
}> {
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
  const bodyContext = { accessToken, remainingBytes: CONNECTOR_TEXT_DOCUMENT_MAX_BYTES, signal }
  if (
    !lines.push(
      `Subject: ${subject}`,
      `From: ${from}`,
      ...(to ? [`To: ${to}`] : []),
      `Messages: ${messages.length}`,
      ''
    )
  ) {
    throw new ConnectorFileTooLargeError(CONNECTOR_TEXT_DOCUMENT_MAX_BYTES)
  }

  for (const msg of messages) {
    signal?.throwIfAborted()
    const msgFrom = getHeader(msg.payload, 'From') || 'Unknown'
    const msgDate = getHeader(msg.payload, 'Date') || ''
    const body = msg.payload ? await extractBody(msg.payload, msg.id, bodyContext) : ''

    if (!lines.push(`--- ${msgFrom} (${msgDate}) ---`, body.trim(), '')) {
      throw new ConnectorFileTooLargeError(CONNECTOR_TEXT_DOCUMENT_MAX_BYTES)
    }
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
  format: 'full' | 'minimal' | 'metadata' = 'full',
  signal?: AbortSignal
): Promise<GmailThread | null> {
  signal?.throwIfAborted()
  const params = new URLSearchParams({ format })
  if (format === 'minimal') params.set('fields', 'id,historyId,snippet')
  /** Enough to place every message against the configured scope without any body. */
  if (format === 'metadata')
    params.set('fields', 'id,historyId,snippet,messages(id,labelIds,internalDate)')
  const url = `${GMAIL_API_BASE}/threads/${encodeURIComponent(threadId)}?${params}`

  const response = await fetchWithRetry(url, {
    method: 'GET',
    signal,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    if (response.status === 404) return null
    throw new GmailApiError(`Failed to fetch thread ${threadId}`, response.status)
  }

  const thread = await readResponseJsonWithLimit(response, {
    maxBytes: MAX_THREAD_RESPONSE_BYTES,
    label: 'Gmail thread response',
  })
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
    /** Rehydrate older rows that omitted separately stored message bodies. */
    contentHash: `gmail:${thread.id}:${thread.historyId}:body-v2`,
    skippedRetryPolicy: 'source-change',
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

/** A feed position: the mailbox history id the next read starts from, mid-page when paging. */
interface GmailChangeCursor {
  historyId: string
  pageToken?: string
}

class InvalidGmailChangeCursorError extends Error {
  constructor() {
    super('Malformed Gmail change cursor')
    this.name = 'InvalidGmailChangeCursorError'
  }
}

function parseChangeCursor(cursor: string): GmailChangeCursor {
  if (/^\d+$/.test(cursor)) return { historyId: cursor }
  let parsed: unknown
  try {
    parsed = JSON.parse(cursor)
  } catch {
    throw new InvalidGmailChangeCursorError()
  }
  if (
    !isPlainRecord(parsed) ||
    typeof parsed.historyId !== 'string' ||
    !/^\d+$/.test(parsed.historyId) ||
    (parsed.pageToken !== undefined &&
      (typeof parsed.pageToken !== 'string' || parsed.pageToken.length === 0))
  ) {
    throw new InvalidGmailChangeCursorError()
  }
  return { historyId: parsed.historyId, pageToken: parsed.pageToken as string | undefined }
}

interface GmailHistoryList {
  threadIds: string[]
  nextPageToken?: string
  historyId: string
}

function parseHistoryList(value: unknown): GmailHistoryList {
  if (
    !isPlainRecord(value) ||
    typeof value.historyId !== 'string' ||
    !/^\d+$/.test(value.historyId) ||
    (value.history !== undefined && !Array.isArray(value.history)) ||
    (value.nextPageToken !== undefined &&
      (typeof value.nextPageToken !== 'string' || value.nextPageToken.length === 0))
  ) {
    throw new Error('Gmail returned malformed history metadata')
  }
  const threadIds = new Set<string>()
  for (const record of (value.history ?? []) as unknown[]) {
    if (!isPlainRecord(record) || !Array.isArray(record.messages)) continue
    for (const message of record.messages as unknown[]) {
      if (isPlainRecord(message) && typeof message.threadId === 'string' && message.threadId) {
        threadIds.add(message.threadId)
      }
    }
  }
  return {
    threadIds: [...threadIds],
    nextPageToken: value.nextPageToken as string | undefined,
    historyId: value.historyId,
  }
}

/** The configured listing scope, evaluated locally against a thread's message metadata. */
interface GmailChangeScope {
  after?: Date
  labelIds?: Set<string>
  excludedLabelIds: Set<string>
}

/**
 * Mirrors {@link buildSearchQuery}: a free-form search filter cannot be
 * evaluated here, which is why {@link gmailConnector.supportsChangeFeed}
 * refuses the feed when one is configured.
 */
function buildChangeScope(
  sourceConfig: Record<string, unknown>,
  labelIndex: GmailLabelIndex,
  now: Date
): GmailChangeScope {
  const scope: GmailChangeScope = {
    after: dateRangeStart(sourceConfig, now),
    excludedLabelIds: new Set(),
  }
  const configuredLabels = parseMultiValue(sourceConfig.label)
  if (configuredLabels.length > 0) {
    const labelIds = new Set<string>()
    for (const value of configuredLabels) {
      const id = labelIndex.byId[value] ? value : labelIndex.idByLowerName[value.toLowerCase()]
      if (!id) throw new Error(`Gmail label "${value}" does not exist in this mailbox`)
      labelIds.add(id)
    }
    scope.labelIds = labelIds
  }
  if (sourceConfig.excludePromotions !== 'false') scope.excludedLabelIds.add('CATEGORY_PROMOTIONS')
  if (sourceConfig.excludeSocial !== 'false') scope.excludedLabelIds.add('CATEGORY_SOCIAL')
  return scope
}

/**
 * Gmail matches search terms per message and returns the thread of any
 * matching message, so a thread is in scope while one message outside Spam and
 * Trash satisfies every configured filter.
 */
function threadInScope(thread: GmailThread, scope: GmailChangeScope): boolean {
  return (thread.messages ?? []).some((message) => {
    const labels = new Set(message.labelIds ?? [])
    for (const label of labels) {
      if (HIDDEN_LABEL_IDS.has(label) || scope.excludedLabelIds.has(label)) return false
    }
    if (scope.labelIds && ![...scope.labelIds].some((id) => labels.has(id))) return false
    if (scope.after) {
      const sentAt = Number(message.internalDate)
      if (!Number.isFinite(sentAt) || sentAt < scope.after.getTime()) return false
    }
    return true
  })
}

const gmailMailboxConnector: ConnectorConfig = {
  ...gmailConnectorMeta,

  isCredentialInvalidError: (error) => error instanceof GmailApiError && error.status === 401,

  /** The mailbox's current history id; `users.history.list` replays everything after it. */
  getChangeCursor: async (accessToken, _sourceConfig, syncContext): Promise<string> => {
    if (syncContext?.mirrorsSourceAcls === true) {
      throw new Error('Company-wide Gmail indexing uses complete mailbox listings')
    }
    const response = await fetchWithRetry(`${GMAIL_API_BASE}/profile?fields=historyId`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    })
    if (!response.ok) throw new GmailApiError('Failed to read the Gmail profile', response.status)
    const data: unknown = await response.json()
    if (
      !isPlainRecord(data) ||
      typeof data.historyId !== 'string' ||
      !/^\d+$/.test(data.historyId)
    ) {
      throw new Error('Gmail returned malformed profile metadata')
    }
    return JSON.stringify({ historyId: data.historyId })
  },

  /** Labels, dates and categories are checked locally; a free-form search filter cannot be. */
  supportsChangeFeed: (sourceConfig) =>
    typeof sourceConfig.query !== 'string' || sourceConfig.query.trim() === '',

  /**
   * Reads `users.history.list` from the cursor and re-reads each touched
   * thread's metadata. A thread that still matches the configured scope is an
   * upsert carrying the same stub a listing produces; one that was deleted,
   * trashed, or relabelled out of scope is a removal.
   */
  listChanges: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    cursor: string,
    syncContext?: Record<string, unknown>
  ): Promise<ExternalChangeList> => {
    if (syncContext?.mirrorsSourceAcls === true) {
      throw new Error('Company-wide Gmail indexing uses complete mailbox listings')
    }
    const { historyId, pageToken } = parseChangeCursor(cursor)
    let labelIndex = EMPTY_LABEL_INDEX
    if (parseMultiValue(sourceConfig.label).length > 0) {
      const resolved = await getLabelIndex(accessToken, syncContext)
      if (!resolved) {
        throw new Error('Failed to fetch Gmail labels; cannot resolve the configured label filter')
      }
      labelIndex = resolved
    }
    const scope = buildChangeScope(sourceConfig, labelIndex, new Date())

    const params = new URLSearchParams({
      startHistoryId: historyId,
      maxResults: String(HISTORY_PAGE_SIZE),
      fields: 'history(messages(threadId)),nextPageToken,historyId',
    })
    for (const type of HISTORY_TYPES) params.append('historyTypes', type)
    if (pageToken) params.set('pageToken', pageToken)

    const response = await fetchWithRetry(`${GMAIL_API_BASE}/history?${params.toString()}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    })
    if (!response.ok) {
      logger.warn('Failed to list Gmail history', { status: response.status })
      throw new GmailApiError('Failed to list Gmail history', response.status)
    }
    const page = parseHistoryList(await response.json())

    const changes = await mapWithConcurrency(
      page.threadIds,
      CHANGED_THREAD_CONCURRENCY,
      async (threadId): Promise<ExternalChange> => {
        const externalId = memberDocumentId(threadId, syncContext)
        const thread = await fetchThread(accessToken, threadId, 'metadata')
        if (!thread || !threadInScope(thread, scope)) return { kind: 'removed', externalId }
        return { kind: 'upsert', externalId, document: threadToStub(thread, syncContext) }
      }
    )

    const next: GmailChangeCursor = page.nextPageToken
      ? { historyId, pageToken: page.nextPageToken }
      : { historyId: page.historyId }
    return { changes, nextCursor: JSON.stringify(next), hasMore: Boolean(page.nextPageToken) }
  },

  /** Gmail answers 404 once `startHistoryId` falls outside the history it retains. */
  isChangeCursorInvalidError: (error) =>
    error instanceof InvalidGmailChangeCursorError ||
    (error instanceof GmailApiError && error.status === 404),

  listDocuments: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    cursor?: string,
    syncContext?: Record<string, unknown>
  ): Promise<ExternalDocumentList> => {
    const signal = syncContext?.signal instanceof AbortSignal ? syncContext.signal : undefined
    signal?.throwIfAborted()
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
      signal,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    })

    if (!response.ok) {
      logger.error('Failed to list Gmail threads', { status: response.status })
      throw new GmailApiError('Failed to list Gmail threads', response.status)
    }

    /** Gmail can return 204 when an empty listing has no requested metadata fields. */
    const { threads, nextPageToken } = parseThreadList(
      response.status === 204
        ? {}
        : await readResponseJsonWithLimit(response, {
            maxBytes: MAX_METADATA_RESPONSE_BYTES,
            label: 'Gmail thread listing',
          })
    )
    signal?.throwIfAborted()
    const stubs = await mapWithConcurrency(threads, 5, async (thread) => {
      const metadata = thread.historyId
        ? thread
        : await fetchThread(accessToken, thread.id, 'minimal', signal)
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
      currentCursor: JSON.stringify({ ...(pageToken ? { pageToken } : {}), searchQuery }),
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
    const signal = syncContext?.signal instanceof AbortSignal ? syncContext.signal : undefined
    signal?.throwIfAborted()
    const threadId = sourceDocumentId(externalId, syncContext)
    if (!threadId) return null
    let thread: GmailThread | null
    try {
      thread = await fetchThread(accessToken, threadId, 'full', signal)
    } catch (error) {
      if (!isConfirmedResponseOverflow(error, 'Gmail thread response')) throw error
      const before = await fetchThread(accessToken, threadId, 'minimal', signal)
      if (!before) return null

      /** The capped response has no verified revision; bracket one bounded retry before caching a skip. */
      try {
        thread = await fetchThread(accessToken, threadId, 'full', signal)
      } catch (retryError) {
        if (!isConfirmedResponseOverflow(retryError, 'Gmail thread response')) throw retryError
        const after = await fetchThread(accessToken, threadId, 'minimal', signal)
        if (!after) return null
        if (before.historyId !== after.historyId) {
          throw new Error('Gmail thread changed while checking its size')
        }
        return {
          ...markSkipped(
            threadToStub(after, syncContext),
            sizeLimitSkipReason(MAX_THREAD_RESPONSE_BYTES)
          ),
          skippedExistingDisposition: 'replace',
        }
      }
    }
    if (!thread) return null

    let formatted: Awaited<ReturnType<typeof formatThread>>
    try {
      formatted = await formatThread(thread, accessToken, signal)
    } catch (error) {
      if (error instanceof ConnectorFileTooLargeError) {
        return {
          ...markSkipped(threadToStub(thread, syncContext), sizeLimitSkipReason(error.limitBytes)),
          skippedExistingDisposition: 'replace',
        }
      }
      throw error
    }
    const { content, subject, metadata } = formatted
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
    sourceConfig: Record<string, unknown>,
    syncContext?: Record<string, unknown>
  ): Promise<{ valid: boolean; error?: string }> => {
    const signal = syncContext?.signal instanceof AbortSignal ? syncContext.signal : undefined
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
          signal,
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
            signal,
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

        const labels = await readLabels(labelsResponse)
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
            signal,
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

/** A complete mailbox corpus cannot stop at a per-user cap or reuse another mailbox's label IDs. */
function centralGmailConfig(sourceConfig: Record<string, unknown>): Record<string, unknown> {
  if (
    parseOptionalUnlimitedSafeInteger(
      sourceConfig.maxThreads,
      'Max Threads must be a non-negative whole number'
    ) > 0
  ) {
    throw new Error(
      'Max Threads is not supported for company-wide indexing; narrow Users or filters instead'
    )
  }
  if (parseMultiValue(sourceConfig.label).some((label) => label.startsWith('Label_'))) {
    throw new Error(
      'Use Gmail label names instead of account-specific label IDs for company-wide indexing'
    )
  }
  return { ...sourceConfig, maxThreads: 0 }
}

export const gmailConnector: ConnectorConfig = {
  ...gmailMailboxConnector,
  isListingCursorInvalidError: (error) => error instanceof InvalidGoogleWorkspaceCursor,
  listDocuments: async (accessToken, sourceConfig, cursor, syncContext) =>
    syncContext?.mirrorsSourceAcls === true
      ? listGoogleWorkspaceDocuments({
          provider: 'gmail',
          accessToken,
          sourceConfig: centralGmailConfig(sourceConfig),
          cursor,
          syncContext,
          listUserDocuments: gmailMailboxConnector.listDocuments,
        })
      : gmailMailboxConnector.listDocuments(accessToken, sourceConfig, cursor, syncContext),
  getDocument: (accessToken, sourceConfig, externalId, syncContext) =>
    syncContext?.mirrorsSourceAcls === true
      ? getGoogleWorkspaceDocument({
          provider: 'gmail',
          sourceConfig,
          externalId,
          syncContext,
          getUserDocument: gmailMailboxConnector.getDocument,
        })
      : gmailMailboxConnector.getDocument(accessToken, sourceConfig, externalId, syncContext),
  validateConfig: async (accessToken, sourceConfig, syncContext) => {
    if (syncContext?.mirrorsSourceAcls !== true) {
      return gmailMailboxConnector.validateConfig(accessToken, sourceConfig, syncContext)
    }
    try {
      const config = centralGmailConfig(sourceConfig)
      const delegated = await validateGoogleWorkspaceConfig({
        provider: 'gmail',
        accessToken,
        sourceConfig: config,
        syncContext,
      })
      /** A label can exist in another selected mailbox even when the validation sample lacks it. */
      return gmailMailboxConnector.validateConfig(
        delegated.accessToken,
        { ...config, label: [] },
        delegated.syncContext
      )
    } catch (error) {
      return { valid: false, error: getErrorMessage(error, 'Failed to validate Gmail indexing') }
    }
  },
}
