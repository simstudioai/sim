import { createLogger } from '@sim/logger'
import { OutlookIcon } from '@/components/icons'
import { toError } from '@/lib/core/utils/helpers'
import { fetchWithRetry, VALIDATE_RETRY_OPTIONS } from '@/lib/knowledge/documents/utils'
import type { ConnectorConfig, ExternalDocument, ExternalDocumentList } from '@/connectors/types'
import { htmlToPlainText, parseTagDate } from '@/connectors/utils'

const logger = createLogger('OutlookConnector')

const GRAPH_API_BASE = 'https://graph.microsoft.com/v1.0/me'
const DEFAULT_MAX_CONVERSATIONS = 500
const MESSAGES_PER_PAGE = 50
/**
 * Fields requested when listing messages (no body — deferred to getDocument).
 */
const LIST_MESSAGE_FIELDS = [
  'id',
  'conversationId',
  'subject',
  'from',
  'toRecipients',
  'receivedDateTime',
  'sentDateTime',
  'categories',
  'importance',
  'inferenceClassification',
  'hasAttachments',
  'webLink',
  'isDraft',
  'parentFolderId',
].join(',')

/**
 * Fields requested when fetching full message content in getDocument.
 */
const FULL_MESSAGE_FIELDS = [
  'id',
  'conversationId',
  'subject',
  'from',
  'toRecipients',
  'receivedDateTime',
  'sentDateTime',
  'body',
  'categories',
  'importance',
  'inferenceClassification',
  'hasAttachments',
  'webLink',
  'isDraft',
  'parentFolderId',
].join(',')

/**
 * Maximum total messages to fetch before grouping into conversations.
 * Prevents unbounded memory usage for very large mailboxes.
 */
const MAX_TOTAL_MESSAGES = 5000

interface OutlookEmailAddress {
  name?: string
  address?: string
}

interface OutlookRecipient {
  emailAddress?: OutlookEmailAddress
}

interface OutlookMessage {
  id: string
  conversationId?: string
  subject?: string
  from?: OutlookRecipient
  toRecipients?: OutlookRecipient[]
  receivedDateTime?: string
  sentDateTime?: string
  body?: { contentType?: string; content?: string }
  categories?: string[]
  importance?: string
  inferenceClassification?: string
  hasAttachments?: boolean
  webLink?: string
  isDraft?: boolean
  parentFolderId?: string
}

/**
 * Well-known Outlook folder names that can be used directly in the Graph API.
 */
const WELL_KNOWN_FOLDERS: Record<string, string> = {
  inbox: 'inbox',
  sentitems: 'sentitems',
  drafts: 'drafts',
  deleteditems: 'deleteditems',
  archive: 'archive',
  junkemail: 'junkemail',
}

/**
 * Builds the initial Graph API URL for listing messages.
 */
function buildInitialUrl(sourceConfig: Record<string, unknown>): string {
  const folder = (sourceConfig.folder as string) || 'inbox'
  const basePath =
    folder === 'all'
      ? `${GRAPH_API_BASE}/messages`
      : `${GRAPH_API_BASE}/mailFolders/${WELL_KNOWN_FOLDERS[folder] || folder}/messages`

  const params = new URLSearchParams({
    $top: String(MESSAGES_PER_PAGE),
    $select: LIST_MESSAGE_FIELDS,
  })

  // Build $filter clauses
  const filterParts: string[] = []

  // Date range filter
  const dateRange = (sourceConfig.dateRange as string) || 'all'
  const dateIso = getDateRangeIso(dateRange)
  if (dateIso) {
    filterParts.push(`receivedDateTime ge ${dateIso}`)
  }

  // When $search is active, Graph API restricts which $filter properties work.
  // Apply isDraft and inferenceClassification filters client-side in that case.
  const searchQuery = sourceConfig.query as string | undefined
  const hasSearch = Boolean(searchQuery?.trim())

  if (!hasSearch) {
    filterParts.push('isDraft eq false')
  }

  // Focused inbox filter — only apply server-side when no $search
  const focusedOnly = sourceConfig.focusedOnly !== 'false'
  if (focusedOnly && !hasSearch) {
    filterParts.push("inferenceClassification eq 'focused'")
  }

  if (filterParts.length > 0) {
    params.set('$filter', filterParts.join(' and '))
  }

  // Free-text search (KQL syntax)
  if (searchQuery?.trim()) {
    params.set('$search', `"${searchQuery.trim()}"`)
  }

  return `${basePath}?${params.toString()}`
}

/**
 * Returns an ISO 8601 date string for the start of the given date range.
 */
function getDateRangeIso(dateRange: string): string | null {
  const now = new Date()
  let daysBack: number | null = null

  switch (dateRange) {
    case '7d':
      daysBack = 7
      break
    case '30d':
      daysBack = 30
      break
    case '90d':
      daysBack = 90
      break
    case '6m':
      daysBack = 180
      break
    case '1y':
      daysBack = 365
      break
    default:
      return null
  }

  const date = new Date(now.getTime() - daysBack * 24 * 60 * 60 * 1000)
  return date.toISOString()
}

/**
 * Formats a recipient's display string.
 */
function formatRecipient(recipient?: OutlookRecipient): string {
  if (!recipient?.emailAddress) return 'Unknown'
  const { name, address } = recipient.emailAddress
  if (name && address) return `${name} <${address}>`
  return name || address || 'Unknown'
}

/**
 * Extracts plain text from an Outlook message body.
 * The Prefer header requests text/plain, but falls back to HTML stripping.
 */
function extractBodyText(body?: OutlookMessage['body']): string {
  if (!body?.content) return ''
  if (body.contentType?.toLowerCase() === 'text') return body.content
  return htmlToPlainText(body.content)
}

/**
 * Groups messages by conversationId and formats each conversation as a document.
 */
function formatConversation(
  conversationId: string,
  messages: OutlookMessage[]
): { content: string; subject: string; metadata: Record<string, unknown> } | null {
  if (messages.length === 0) return null

  // Sort by receivedDateTime ascending (oldest first)
  const sorted = [...messages].sort((a, b) => {
    const dateA = a.receivedDateTime ? new Date(a.receivedDateTime).getTime() : 0
    const dateB = b.receivedDateTime ? new Date(b.receivedDateTime).getTime() : 0
    return dateA - dateB
  })

  const first = sorted[0]
  const last = sorted[sorted.length - 1]
  const subject = first.subject || 'No Subject'
  const from = formatRecipient(first.from)
  const to = first.toRecipients?.map(formatRecipient).join(', ') || ''

  const lines: string[] = []
  lines.push(`Subject: ${subject}`)
  lines.push(`From: ${from}`)
  if (to) lines.push(`To: ${to}`)
  lines.push(`Messages: ${sorted.length}`)
  lines.push('')

  for (const msg of sorted) {
    const msgFrom = formatRecipient(msg.from)
    const msgDate = msg.receivedDateTime || ''
    const body = extractBodyText(msg.body)

    lines.push(`--- ${msgFrom} (${msgDate}) ---`)
    lines.push(body.trim())
    lines.push('')
  }

  const content = lines.join('\n').trim()
  if (!content) return null

  const categories = new Set<string>()
  for (const msg of sorted) {
    if (msg.categories) {
      for (const cat of msg.categories) categories.add(cat)
    }
  }

  return {
    content,
    subject,
    metadata: {
      from,
      to,
      subject,
      conversationId,
      messageCount: sorted.length,
      categories: [...categories],
      importance: first.importance,
      firstMessageDate: first.receivedDateTime,
      lastMessageDate: last.receivedDateTime,
      hasAttachments: sorted.some((m) => m.hasAttachments),
    },
  }
}

export const outlookConnector: ConnectorConfig = {
  id: 'outlook',
  name: 'Outlook',
  description: 'Sync email conversations from Outlook into your knowledge base',
  version: '1.0.0',
  icon: OutlookIcon,

  auth: {
    mode: 'oauth',
    provider: 'outlook',
    requiredScopes: ['Mail.Read'],
  },

  configFields: [
    {
      id: 'folderSelector',
      title: 'Folder',
      type: 'selector',
      selectorKey: 'outlook.folders',
      canonicalParamId: 'folder',
      mode: 'basic',
      placeholder: 'Select a folder',
      required: false,
    },
    {
      id: 'folder',
      title: 'Folder',
      type: 'dropdown',
      canonicalParamId: 'folder',
      mode: 'advanced',
      required: false,
      options: [
        { label: 'Inbox', id: 'inbox' },
        { label: 'All Mail', id: 'all' },
        { label: 'Sent Items', id: 'sentitems' },
        { label: 'Archive', id: 'archive' },
      ],
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
      id: 'focusedOnly',
      title: 'Focused Inbox Only',
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
      placeholder: 'e.g. from:boss@company.com subject:report hasAttachment:true',
      required: false,
      description: 'Search filter using Outlook KQL syntax.',
    },
    {
      id: 'maxConversations',
      title: 'Max Conversations',
      type: 'short-input',
      required: false,
      placeholder: `e.g. 200 (default: ${DEFAULT_MAX_CONVERSATIONS})`,
    },
  ],

  listDocuments: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    cursor?: string,
    syncContext?: Record<string, unknown>
  ): Promise<ExternalDocumentList> => {
    const maxConversations = sourceConfig.maxConversations
      ? Number(sourceConfig.maxConversations)
      : DEFAULT_MAX_CONVERSATIONS

    // Initialize accumulator in syncContext
    if (syncContext && !syncContext._conversations) {
      syncContext._conversations = {} as Record<string, OutlookMessage[]>
      syncContext._totalMessagesFetched = 0
      syncContext._fetchComplete = false
    }

    const conversations = (syncContext?._conversations ?? {}) as Record<string, OutlookMessage[]>
    const totalFetched = (syncContext?._totalMessagesFetched as number) ?? 0

    // Phase 1: Fetch messages and accumulate by conversationId
    if (!syncContext?._fetchComplete) {
      const url = cursor || buildInitialUrl(sourceConfig)

      logger.info('Fetching Outlook messages', {
        cursor: cursor ? 'continuation' : 'initial',
        totalFetched,
      })

      const headers: Record<string, string> = {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      }

      const response = await fetchWithRetry(url, { method: 'GET', headers })

      if (!response.ok) {
        const errorText = await response.text()
        logger.error('Failed to fetch Outlook messages', {
          status: response.status,
          error: errorText,
        })
        throw new Error(`Failed to fetch Outlook messages: ${response.status}`)
      }

      const data = await response.json()
      const messages = (data.value || []) as OutlookMessage[]

      // Client-side filtering when $search is active (Graph API can't combine these with $search)
      const focusedOnly = sourceConfig.focusedOnly !== 'false'
      const hasSearch = Boolean((sourceConfig.query as string)?.trim())

      for (const msg of messages) {
        // Skip drafts (filtered server-side when no search, client-side otherwise)
        if (hasSearch && msg.isDraft) {
          continue
        }

        // Apply focused filter client-side when search prevented server-side filter
        if (focusedOnly && hasSearch && msg.inferenceClassification !== 'focused') {
          continue
        }

        if (!msg.conversationId) continue
        const convId = msg.conversationId
        if (!conversations[convId]) {
          conversations[convId] = []
        }
        conversations[convId].push(msg)
      }

      const newTotal = totalFetched + messages.length
      if (syncContext) {
        syncContext._totalMessagesFetched = newTotal
      }

      const nextLink = data['@odata.nextLink'] as string | undefined
      if (nextLink && newTotal < MAX_TOTAL_MESSAGES) {
        return { documents: [], nextCursor: nextLink, hasMore: true }
      }

      if (syncContext) {
        syncContext._fetchComplete = true
      }
    }

    // Phase 2: Build lightweight stubs — content is deferred to getDocument
    logger.info('Building Outlook conversation stubs', {
      totalMessages: syncContext?._totalMessagesFetched,
      totalConversations: Object.keys(conversations).length,
    })

    const conversationEntries = Object.entries(conversations)

    // Sort by latest message date descending (find actual max, API order is not guaranteed)
    conversationEntries.sort((a, b) => {
      const maxDateA = a[1].reduce((max, m) => {
        const d = m.receivedDateTime || ''
        return d > max ? d : max
      }, '')
      const maxDateB = b[1].reduce((max, m) => {
        const d = m.receivedDateTime || ''
        return d > max ? d : max
      }, '')
      return maxDateB.localeCompare(maxDateA)
    })

    // Limit to maxConversations
    const limited = conversationEntries.slice(0, maxConversations)

    const documents: ExternalDocument[] = []
    for (const [convId, msgs] of limited) {
      if (msgs.length === 0) continue

      const lastDate = msgs.reduce((max, m) => {
        const d = m.receivedDateTime || ''
        return d > max ? d : max
      }, '')

      const subject = msgs[0].subject || 'No Subject'
      const firstWithLink = msgs.find((m) => m.webLink)
      const sourceUrl = firstWithLink?.webLink || 'https://outlook.office.com/mail/inbox'

      documents.push({
        externalId: convId,
        title: subject,
        content: '',
        contentDeferred: true,
        mimeType: 'text/plain',
        sourceUrl,
        contentHash: `outlook:${convId}:${lastDate}`,
        metadata: {},
      })
    }

    return { documents, hasMore: false }
  },

  getDocument: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    externalId: string
  ): Promise<ExternalDocument | null> => {
    try {
      // Scope to the same folder as listDocuments so contentHash stays consistent
      const folder = (sourceConfig.folder as string) || 'inbox'
      const basePath =
        folder === 'all'
          ? `${GRAPH_API_BASE}/messages`
          : `${GRAPH_API_BASE}/mailFolders/${WELL_KNOWN_FOLDERS[folder] || folder}/messages`

      const filterParts = [
        `conversationId eq '${externalId.replace(/'/g, "''")}'`,
        'isDraft eq false',
      ]

      const params = new URLSearchParams({
        $filter: filterParts.join(' and '),
        $select: FULL_MESSAGE_FIELDS,
        $top: '250',
      })

      const url = `${basePath}?${params.toString()}`

      const response = await fetchWithRetry(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
          Prefer: 'outlook.body-content-type="text"',
        },
      })

      if (!response.ok) {
        if (response.status === 404) return null
        throw new Error(`Failed to fetch Outlook conversation: ${response.status}`)
      }

      const data = await response.json()
      const messages = (data.value || []) as OutlookMessage[]

      if (messages.length === 0) return null

      const result = formatConversation(externalId, messages)
      if (!result) return null

      const lastDate = messages.reduce((max, m) => {
        const d = m.receivedDateTime || ''
        return d > max ? d : max
      }, '')

      const firstWithLink = messages.find((m) => m.webLink)

      return {
        externalId,
        title: result.subject,
        content: result.content,
        contentDeferred: false,
        mimeType: 'text/plain',
        sourceUrl: firstWithLink?.webLink || 'https://outlook.office.com/mail/inbox',
        contentHash: `outlook:${externalId}:${lastDate}`,
        metadata: result.metadata,
      }
    } catch (error) {
      logger.warn('Failed to get Outlook conversation', {
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
    const maxConversations = sourceConfig.maxConversations as string | undefined

    if (
      maxConversations &&
      (Number.isNaN(Number(maxConversations)) || Number(maxConversations) <= 0)
    ) {
      return { valid: false, error: 'Max conversations must be a positive number' }
    }

    try {
      // Verify Graph API access
      const folder = (sourceConfig.folder as string) || 'inbox'
      const testUrl =
        folder === 'all'
          ? `${GRAPH_API_BASE}/messages?$top=1&$select=id`
          : `${GRAPH_API_BASE}/mailFolders/${WELL_KNOWN_FOLDERS[folder] || folder}/messages?$top=1&$select=id`

      const response = await fetchWithRetry(
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

      if (!response.ok) {
        if (response.status === 404) {
          return { valid: false, error: `Folder "${folder}" not found` }
        }
        return { valid: false, error: `Failed to access Outlook: ${response.status}` }
      }

      // If a search query is specified, verify it's valid with a dry run
      const searchQuery = sourceConfig.query as string | undefined
      if (searchQuery?.trim()) {
        const searchParams = new URLSearchParams({
          $search: `"${searchQuery.trim()}"`,
          $top: '1',
          $select: 'id',
        })
        const searchUrl = `${GRAPH_API_BASE}/messages?${searchParams.toString()}`
        const searchResponse = await fetchWithRetry(
          searchUrl,
          {
            method: 'GET',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              Accept: 'application/json',
            },
          },
          VALIDATE_RETRY_OPTIONS
        )

        if (!searchResponse.ok) {
          return {
            valid: false,
            error: 'Invalid search query. Check Outlook search syntax.',
          }
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
    { id: 'categories', displayName: 'Categories', fieldType: 'text' },
    { id: 'importance', displayName: 'Importance', fieldType: 'text' },
    { id: 'messageCount', displayName: 'Messages in Conversation', fieldType: 'number' },
    { id: 'lastMessageDate', displayName: 'Last Message', fieldType: 'date' },
  ],

  mapTags: (metadata: Record<string, unknown>): Record<string, unknown> => {
    const result: Record<string, unknown> = {}

    if (typeof metadata.from === 'string') {
      result.from = metadata.from
    }

    const categories = Array.isArray(metadata.categories) ? (metadata.categories as string[]) : []
    if (categories.length > 0) {
      result.categories = categories.join(', ')
    }

    if (typeof metadata.importance === 'string') {
      result.importance = metadata.importance
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
