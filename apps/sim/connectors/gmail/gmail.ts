import { createLogger } from '@sim/logger'
import { GmailIcon } from '@/components/icons'
import { toError } from '@/lib/core/utils/helpers'
import { fetchWithRetry, VALIDATE_RETRY_OPTIONS } from '@/lib/knowledge/documents/utils'
import type { ConnectorConfig, ExternalDocument, ExternalDocumentList } from '@/connectors/types'
import { htmlToPlainText, joinTagArray, parseTagDate } from '@/connectors/utils'

const logger = createLogger('GmailConnector')

const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me'
const DEFAULT_MAX_THREADS = 500
const THREADS_PER_PAGE = 100

interface GmailHeader {
  name: string
  value: string
}

interface GmailMessagePart {
  mimeType?: string
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

interface GmailLabel {
  id: string
  name: string
  type?: string
}

/**
 * Builds a Gmail search query string from the source config.
 * Combines the user's custom query with the label and date range filters.
 */
function buildSearchQuery(sourceConfig: Record<string, unknown>): string {
  const parts: string[] = []

  const labelName = sourceConfig.label as string | undefined
  if (labelName?.trim()) {
    parts.push(`label:${labelName.trim().replace(/\s+/g, '-')}`)
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
  if (customQuery?.trim()) {
    parts.push(customQuery.trim())
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
 * Extracts the plain text body from a Gmail message payload.
 * Prefers text/plain, falls back to text/html with tag stripping.
 */
function extractBody(part: GmailMessagePart): string {
  if (part.mimeType === 'text/plain' && part.body?.data) {
    return decodeBase64Url(part.body.data)
  }

  if (part.parts) {
    // Prefer text/plain from multipart
    for (const child of part.parts) {
      if (child.mimeType === 'text/plain' && child.body?.data) {
        return decodeBase64Url(child.body.data)
      }
    }
    // Fall back to text/html
    for (const child of part.parts) {
      if (child.mimeType === 'text/html' && child.body?.data) {
        return htmlToPlainText(decodeBase64Url(child.body.data))
      }
    }
    // Recurse into nested multipart
    for (const child of part.parts) {
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
  const labelIds = firstMessage.labelIds || []

  const lines: string[] = []
  lines.push(`Subject: ${subject}`)
  lines.push(`From: ${from}`)
  if (to) lines.push(`To: ${to}`)
  lines.push(`Messages: ${messages.length}`)
  lines.push('')

  for (const msg of messages) {
    const msgFrom = getHeader(msg.payload, 'From') || 'Unknown'
    const msgDate = getHeader(msg.payload, 'Date') || ''
    const body = msg.payload ? extractBody(msg.payload) : ''

    lines.push(`--- ${msgFrom} (${msgDate}) ---`)
    lines.push(body.trim())
    lines.push('')
  }

  const firstDate = firstMessage.internalDate
    ? new Date(Number(firstMessage.internalDate)).toISOString()
    : undefined
  const lastDate = lastMessage.internalDate
    ? new Date(Number(lastMessage.internalDate)).toISOString()
    : undefined

  return {
    content: lines.join('\n').trim(),
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
 * Fetches a full thread with all its messages.
 */
async function fetchThread(accessToken: string, threadId: string): Promise<GmailThread | null> {
  const url = `${GMAIL_API_BASE}/threads/${threadId}?format=FULL`

  const response = await fetchWithRetry(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    if (response.status === 404) return null
    throw new Error(`Failed to fetch thread ${threadId}: ${response.status}`)
  }

  return (await response.json()) as GmailThread
}

/**
 * Resolves label IDs to human-readable label names using a cache.
 */
async function resolveLabelNames(
  accessToken: string,
  labelIds: string[],
  syncContext?: Record<string, unknown>
): Promise<string[]> {
  const cacheKey = '_gmailLabelCache'

  if (syncContext && !syncContext[cacheKey]) {
    try {
      const url = `${GMAIL_API_BASE}/labels`
      const response = await fetchWithRetry(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
      })

      if (response.ok) {
        const data = await response.json()
        const labels = (data.labels || []) as GmailLabel[]
        const labelMap: Record<string, string> = {}
        for (const label of labels) {
          labelMap[label.id] = label.name
        }
        syncContext[cacheKey] = labelMap
      }
    } catch {
      syncContext[cacheKey] = {}
    }
  }

  const cache = (syncContext?.[cacheKey] as Record<string, string>) ?? {}
  return labelIds
    .map((id) => cache[id] || id)
    .filter((name) => !name.startsWith('CATEGORY_') && name !== 'UNREAD')
}

/**
 * Creates a lightweight document stub from a thread list entry.
 * Uses metadata-based contentHash for change detection without downloading content.
 */
function threadToStub(thread: {
  id: string
  snippet?: string
  historyId?: string
}): ExternalDocument {
  return {
    externalId: thread.id,
    title: thread.snippet || 'Untitled Thread',
    content: '',
    contentDeferred: true,
    mimeType: 'text/plain',
    sourceUrl: `https://mail.google.com/mail/u/0/#inbox/${thread.id}`,
    contentHash: `gmail:${thread.id}:${thread.historyId ?? ''}`,
    metadata: {},
  }
}

export const gmailConnector: ConnectorConfig = {
  id: 'gmail',
  name: 'Gmail',
  description: 'Sync email threads from Gmail into your knowledge base',
  version: '1.0.0',
  icon: GmailIcon,

  auth: {
    mode: 'oauth',
    provider: 'google-email',
    requiredScopes: ['https://www.googleapis.com/auth/gmail.modify'],
  },

  configFields: [
    {
      id: 'labelSelector',
      title: 'Label',
      type: 'selector',
      selectorKey: 'gmail.labels',
      canonicalParamId: 'label',
      mode: 'basic',
      placeholder: 'Select a label',
      required: false,
      description: 'Only sync emails with this label. Leave empty for all mail.',
    },
    {
      id: 'label',
      title: 'Label',
      type: 'short-input',
      canonicalParamId: 'label',
      mode: 'advanced',
      placeholder: 'e.g. INBOX, IMPORTANT, or a custom label name',
      required: false,
      description: 'Only sync emails with this label. Leave empty for all mail.',
    },
    {
      id: 'dateRange',
      title: 'Date Range',
      type: 'dropdown',
      required: false,
      options: [
        { label: 'Last 7 days', id: '7d' },
        { label: 'Last 30 days', id: '30d' },
        { label: 'Last 90 days', id: '90d' },
        { label: 'Last 6 months', id: '6m' },
        { label: 'Last year', id: '1y' },
        { label: 'All time', id: 'all' },
      ],
    },
    {
      id: 'excludePromotions',
      title: 'Exclude Promotions',
      type: 'dropdown',
      required: false,
      options: [
        { label: 'Yes (recommended)', id: 'true' },
        { label: 'No', id: 'false' },
      ],
    },
    {
      id: 'excludeSocial',
      title: 'Exclude Social',
      type: 'dropdown',
      required: false,
      options: [
        { label: 'Yes (recommended)', id: 'true' },
        { label: 'No', id: 'false' },
      ],
    },
    {
      id: 'query',
      title: 'Search Filter',
      type: 'short-input',
      placeholder: 'e.g. from:boss@company.com subject:report has:attachment',
      required: false,
      description: 'Additional Gmail search filter. Uses the same syntax as the Gmail search bar.',
    },
    {
      id: 'maxThreads',
      title: 'Max Threads',
      type: 'short-input',
      required: false,
      placeholder: `e.g. 200 (default: ${DEFAULT_MAX_THREADS})`,
    },
  ],

  listDocuments: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    cursor?: string,
    syncContext?: Record<string, unknown>
  ): Promise<ExternalDocumentList> => {
    const searchQuery = buildSearchQuery(sourceConfig)
    const maxThreads = sourceConfig.maxThreads
      ? Number(sourceConfig.maxThreads)
      : DEFAULT_MAX_THREADS

    const totalFetched = (syncContext?.totalThreadsFetched as number) ?? 0
    if (totalFetched >= maxThreads) {
      return { documents: [], hasMore: false }
    }

    const remaining = maxThreads - totalFetched
    const pageSize = Math.min(THREADS_PER_PAGE, remaining)

    const queryParams = new URLSearchParams({
      maxResults: String(pageSize),
    })

    if (searchQuery) {
      queryParams.set('q', searchQuery)
    }

    if (cursor) {
      queryParams.set('pageToken', cursor)
    }

    const url = `${GMAIL_API_BASE}/threads?${queryParams.toString()}`

    logger.info('Listing Gmail threads', {
      query: searchQuery,
      cursor: cursor ?? 'initial',
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
      const errorText = await response.text()
      logger.error('Failed to list Gmail threads', { status: response.status, error: errorText })
      throw new Error(`Failed to list Gmail threads: ${response.status}`)
    }

    const data = await response.json()
    const threads = (data.threads || []) as { id: string; snippet?: string; historyId?: string }[]

    if (threads.length === 0) {
      return { documents: [], hasMore: false }
    }

    const documents = threads.map(threadToStub)

    const newTotal = totalFetched + documents.length
    if (syncContext) syncContext.totalThreadsFetched = newTotal

    const nextPageToken = data.nextPageToken as string | undefined
    const hitLimit = newTotal >= maxThreads
    if (hitLimit && syncContext) syncContext.listingCapped = true

    return {
      documents,
      nextCursor: hitLimit ? undefined : nextPageToken,
      hasMore: hitLimit ? false : Boolean(nextPageToken),
    }
  },

  getDocument: async (
    accessToken: string,
    _sourceConfig: Record<string, unknown>,
    externalId: string,
    syncContext?: Record<string, unknown>
  ): Promise<ExternalDocument | null> => {
    try {
      const thread = await fetchThread(accessToken, externalId)
      if (!thread) return null

      const { content, subject, metadata } = formatThread(thread)
      if (!content.trim()) return null

      const labelIds = (metadata.labelIds as string[]) || []
      const labelNames = await resolveLabelNames(accessToken, labelIds, syncContext)
      metadata.labels = labelNames

      return {
        externalId: thread.id,
        title: subject,
        content,
        contentDeferred: false,
        mimeType: 'text/plain',
        sourceUrl: `https://mail.google.com/mail/u/0/#inbox/${thread.id}`,
        contentHash: `gmail:${thread.id}:${thread.historyId ?? ''}`,
        metadata,
      }
    } catch (error) {
      logger.warn('Failed to get Gmail thread', {
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
    const maxThreads = sourceConfig.maxThreads as string | undefined

    if (maxThreads && (Number.isNaN(Number(maxThreads)) || Number(maxThreads) <= 0)) {
      return { valid: false, error: 'Max threads must be a positive number' }
    }

    try {
      // Verify Gmail API access by fetching profile
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

      // If a label is specified, verify it exists
      const labelName = sourceConfig.label as string | undefined
      if (labelName?.trim()) {
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
        const normalized = labelName.trim().toLowerCase()
        const match = labels.find((l) => l.name.toLowerCase() === normalized)

        if (!match) {
          return {
            valid: false,
            error: `Label "${labelName}" not found. Available labels: ${labels
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

      // If a custom query is specified, verify it's valid by doing a dry-run
      const query = sourceConfig.query as string | undefined
      if (query?.trim()) {
        const searchQuery = buildSearchQuery(sourceConfig)
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
      const message = error instanceof Error ? error.message : 'Failed to validate configuration'
      return { valid: false, error: message }
    }
  },

  tagDefinitions: [
    { id: 'from', displayName: 'From', fieldType: 'text' },
    { id: 'labels', displayName: 'Labels', fieldType: 'text' },
    { id: 'messageCount', displayName: 'Messages in Thread', fieldType: 'number' },
    { id: 'lastMessageDate', displayName: 'Last Message', fieldType: 'date' },
  ],

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
