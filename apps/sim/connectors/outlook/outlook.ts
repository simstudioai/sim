import { createLogger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import { fetchWithRetry, VALIDATE_RETRY_OPTIONS } from '@/lib/knowledge/documents/utils'
import { DEFAULT_MAX_CONVERSATIONS, outlookConnectorMeta } from '@/connectors/outlook/meta'
import type { ConnectorConfig, ExternalDocument, ExternalDocumentList } from '@/connectors/types'
import { htmlToPlainText, parseTagDate } from '@/connectors/utils'

const logger = createLogger('OutlookConnector')

const GRAPH_API_BASE = 'https://graph.microsoft.com/v1.0/me'
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

export interface OutlookMessage {
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
 * Graph well-known name of the folder that holds messages the mailbox owner
 * has thrown away. Well-known names resolve regardless of mailbox locale.
 *
 * Outlook has no "deleted" flag on a message — deleting moves it into Deleted
 * Items — so a folder-scoped listing drops deleted messages naturally and KB
 * deletion reconciliation purges them. The mailbox-wide endpoint used for the
 * "All Mail" option does not: Microsoft Graph documents `GET /me/messages` as
 * returning "the messages in the signed-in user's mailbox (including the
 * Deleted Items and Clutter folders)". Without this exclusion a deleted
 * conversation stays in the full listing forever and is never purged from the
 * knowledge base.
 *
 * Deliberately limited to Deleted Items. Junk Email is a Microsoft spam
 * classifier decision on a message that still exists in the mailbox, not a
 * user deletion — excluding it would drop already-indexed conversations out of
 * the listing and make deletion reconciliation hard-delete live content.
 */
export const DELETED_ITEMS_FOLDER = 'deleteditems'

/**
 * Page size for the Deleted Items child-folder walk.
 */
const CHILD_FOLDER_PAGE_SIZE = 100

/**
 * Upper bound on Graph requests spent walking the Deleted Items subtree,
 * covering both the well-known folder lookup and every `childFolders` page.
 *
 * Residual gap: a mailbox whose Deleted Items subtree needs more requests than
 * this budget leaves its deepest folders unresolved. Those folders are then not
 * excluded, so messages deleted into them stay indexed until they are purged
 * from the mailbox. That is the deliberate failure direction — under-excluding
 * only leaves stale documents, while over-excluding would hard-delete live
 * conversations from the knowledge base.
 */
const MAX_FOLDER_RESOLUTION_REQUESTS = 25

/**
 * Key under which the resolved exclusion set is memoized on the per-sync-run
 * `syncContext`. Scoping the cache to a sync run keeps it bound to one mailbox
 * without ever holding an OAuth access token in a process-global structure.
 */
const EXCLUDED_FOLDER_IDS_CONTEXT_KEY = '_outlookExcludedFolderIds'

const EMPTY_FOLDER_IDS: ReadonlySet<string> = new Set<string>()

/**
 * A mail folder as returned by the folder endpoints, narrowed to the fields
 * needed to walk the Deleted Items subtree.
 */
export interface OutlookMailFolder {
  id?: string
  childFolderCount?: number
}

/**
 * Resolves the configured folder, defaulting to the inbox.
 */
export function resolveFolder(sourceConfig: Record<string, unknown>): string {
  const folder = sourceConfig.folder
  if (typeof folder !== 'string') return 'inbox'
  const trimmed = folder.trim()
  return trimmed || 'inbox'
}

/**
 * Whether the sync targets the mailbox-wide `/me/messages` endpoint, which is
 * the only path that can surface Deleted Items content.
 */
export function isAllMailSync(sourceConfig: Record<string, unknown>): boolean {
  return resolveFolder(sourceConfig) === 'all'
}

/**
 * Keeps a message unless its parent folder is an explicitly excluded one.
 *
 * Fails open: a message with no `parentFolderId` (unselected or omitted by
 * Graph) or an unresolved exclusion set is kept, because a false exclusion
 * would hard-delete a still-current conversation from the knowledge base.
 */
export function isCurrentMessage(
  message: Pick<OutlookMessage, 'parentFolderId'>,
  excludedFolderIds: ReadonlySet<string>
): boolean {
  if (excludedFolderIds.size === 0) return true
  if (!message.parentFolderId) return true
  return !excludedFolderIds.has(message.parentFolderId)
}

/**
 * Narrows an untyped Graph folder-collection payload into the folders it
 * contains plus its continuation link. Anything unrecognized yields no folders,
 * which fails open into keeping messages.
 */
export function parseFolderCollection(payload: unknown): {
  folders: OutlookMailFolder[]
  nextLink?: string
} {
  if (!payload || typeof payload !== 'object') return { folders: [] }
  const record = payload as Record<string, unknown>
  const value = Array.isArray(record.value) ? record.value : []
  const folders: OutlookMailFolder[] = []

  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue
    const folder = entry as Record<string, unknown>
    if (typeof folder.id !== 'string' || !folder.id) continue
    folders.push({
      id: folder.id,
      childFolderCount: typeof folder.childFolderCount === 'number' ? folder.childFolderCount : 0,
    })
  }

  const nextLink = record['@odata.nextLink']
  return { folders, nextLink: typeof nextLink === 'string' ? nextLink : undefined }
}

/**
 * Performs a `GET` against Graph and returns the parsed JSON body, or `null`
 * when the request failed for any reason. Callers treat `null` as "unresolved"
 * and fail open.
 */
async function fetchFolderJson(url: string, accessToken: string): Promise<unknown | null> {
  try {
    const response = await fetchWithRetry(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    })

    if (!response.ok) {
      logger.warn('Failed to read Outlook mail folder', { url, status: response.status })
      return null
    }

    return await response.json()
  } catch (error) {
    logger.warn('Failed to read Outlook mail folder', {
      url,
      error: getErrorMessage(error, 'Unknown error'),
    })
    return null
  }
}

/**
 * Resolves the id of Deleted Items and of every folder nested beneath it.
 *
 * Graph cannot filter messages by well-known folder name and `parentFolderId`
 * on a message points at its immediate folder, so a message a user deleted
 * while it sat in a user-created folder carries that subfolder's id rather than
 * the Deleted Items id. The subtree is therefore walked breadth-first, spending
 * requests only on folders that report `childFolderCount > 0` and stopping at
 * {@link MAX_FOLDER_RESOLUTION_REQUESTS}.
 *
 * Every id returned is known to sit inside Deleted Items, so a partial result
 * from a failed or truncated walk is still safe — it under-excludes rather than
 * over-excludes.
 */
async function computeExcludedFolderIds(accessToken: string): Promise<ReadonlySet<string>> {
  const ids = new Set<string>()
  let requests = 0

  const rootPayload = await fetchFolderJson(
    `${GRAPH_API_BASE}/mailFolders/${DELETED_ITEMS_FOLDER}?$select=id,childFolderCount`,
    accessToken
  )
  requests++

  if (!rootPayload || typeof rootPayload !== 'object') return EMPTY_FOLDER_IDS
  const root = rootPayload as Record<string, unknown>
  if (typeof root.id !== 'string' || !root.id) return EMPTY_FOLDER_IDS

  ids.add(root.id)

  const pending: string[] =
    typeof root.childFolderCount === 'number' && root.childFolderCount > 0 ? [root.id] : []

  while (pending.length > 0) {
    const parentId = pending.shift()
    if (!parentId) continue

    const params = new URLSearchParams({
      $select: 'id,childFolderCount',
      $top: String(CHILD_FOLDER_PAGE_SIZE),
      includeHiddenFolders: 'true',
    })
    let url: string | undefined =
      `${GRAPH_API_BASE}/mailFolders/${encodeURIComponent(parentId)}/childFolders?${params.toString()}`

    while (url) {
      if (requests >= MAX_FOLDER_RESOLUTION_REQUESTS) {
        logger.warn(
          'Deleted Items folder walk hit its request budget; deeper folders not excluded',
          {
            resolvedFolders: ids.size,
          }
        )
        return ids
      }

      const payload = await fetchFolderJson(url, accessToken)
      requests++
      if (!payload) break

      const { folders, nextLink } = parseFolderCollection(payload)
      for (const folder of folders) {
        if (!folder.id || ids.has(folder.id)) continue
        ids.add(folder.id)
        if ((folder.childFolderCount ?? 0) > 0) pending.push(folder.id)
      }

      url = nextLink
    }
  }

  return ids
}

/**
 * Resolves the excluded folder ids for the current sync run, memoizing the
 * in-flight lookup on `syncContext` when one is available so the concurrent
 * `getDocument` fan-out shares a single folder walk. Without a `syncContext`
 * the lookup is simply repeated — there is deliberately no process-global
 * cache, and in particular none keyed by an OAuth access token.
 */
async function resolveExcludedFolderIds(
  accessToken: string,
  syncContext?: Record<string, unknown>
): Promise<ReadonlySet<string>> {
  if (!syncContext) return computeExcludedFolderIds(accessToken)

  const cached = syncContext[EXCLUDED_FOLDER_IDS_CONTEXT_KEY]
  if (cached instanceof Promise) return cached as Promise<ReadonlySet<string>>

  const pending = computeExcludedFolderIds(accessToken).catch((error) => {
    delete syncContext[EXCLUDED_FOLDER_IDS_CONTEXT_KEY]
    logger.warn('Failed to resolve Outlook Deleted Items folders', {
      error: getErrorMessage(error, 'Unknown error'),
    })
    return EMPTY_FOLDER_IDS
  })
  syncContext[EXCLUDED_FOLDER_IDS_CONTEXT_KEY] = pending
  return pending
}

/**
 * Builds the initial Graph API URL for listing messages.
 */
function buildInitialUrl(sourceConfig: Record<string, unknown>): string {
  const folder = resolveFolder(sourceConfig)
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
  ...outlookConnectorMeta,

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

      const excludedFolderIds = isAllMailSync(sourceConfig)
        ? await resolveExcludedFolderIds(accessToken, syncContext)
        : EMPTY_FOLDER_IDS

      for (const msg of messages) {
        /** Deleted mail must leave the listing so reconciliation can purge it */
        if (!isCurrentMessage(msg, excludedFolderIds)) {
          continue
        }

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
        /**
         * Stopping at `MAX_TOTAL_MESSAGES` while Graph still offers a
         * `@odata.nextLink` means the mailbox was not fully traversed. Flag the
         * listing as capped so deletion reconciliation does not read the
         * unvisited tail as deleted mail and hard-delete those documents.
         */
        if (nextLink) syncContext.listingCapped = true
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

    /**
     * Limit to `maxConversations`. Dropping the overflow makes the listing an
     * incomplete view of the mailbox, so it is flagged as capped — otherwise
     * reconciliation would hard-delete every conversation past the cap.
     */
    const limited = conversationEntries.slice(0, maxConversations)
    if (conversationEntries.length > limited.length && syncContext) {
      syncContext.listingCapped = true
    }

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
    externalId: string,
    syncContext?: Record<string, unknown>
  ): Promise<ExternalDocument | null> => {
    try {
      // Scope to the same folder as listDocuments so contentHash stays consistent
      const folder = resolveFolder(sourceConfig)
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
      const allMessages = (data.value || []) as OutlookMessage[]

      /**
       * Mirrors the listing's exclusion so `contentHash` is computed over the
       * same message set on both sides. Without it, deleting the newest message
       * of a conversation would leave the listing hash (recomputed from the
       * surviving messages) permanently disagreeing with the hash returned
       * here, re-fetching the conversation on every sync forever.
       */
      const excludedFolderIds = isAllMailSync(sourceConfig)
        ? await resolveExcludedFolderIds(accessToken, syncContext)
        : EMPTY_FOLDER_IDS
      const messages = allMessages.filter((msg) => isCurrentMessage(msg, excludedFolderIds))

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
      const folder = resolveFolder(sourceConfig)
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
      const message = getErrorMessage(error, 'Failed to validate configuration')
      return { valid: false, error: message }
    }
  },

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
