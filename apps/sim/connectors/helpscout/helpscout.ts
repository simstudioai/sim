import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { compareStrings } from '@sim/utils/string'
import { z } from 'zod'
import { fetchWithRetry } from '@/lib/knowledge/documents/secure-fetch.server'
import { type RetryOptions, VALIDATE_RETRY_OPTIONS } from '@/lib/knowledge/documents/utils'
import { DEFAULT_MAX_CONVERSATIONS, helpScoutConnectorMeta } from '@/connectors/helpscout/meta'
import type { ConnectorConfig, ExternalDocument, ExternalDocumentList } from '@/connectors/types'
import { computeContentHash, htmlToPlainText, joinTagArray, parseTagDate } from '@/connectors/utils'
import { HELPSCOUT_API_BASE, parseIdText } from '@/tools/helpscout/utils'

const logger = createLogger('HelpScoutConnector')

const STATUSES = new Set(['all', 'active', 'pending', 'closed'])
/** Help Scout caps a conversation at 100 threads, 50 per page, so two pages cover every thread. */
const MAX_THREAD_PAGES = 4
/** Help Scout returns 25 conversations per page. */
const CONVERSATIONS_PER_PAGE = 25
/** Hard ceiling on Max Conversations so one sync cannot walk an entire account. */
const MAX_CONVERSATIONS_LIMIT = 5000
/**
 * Spam and drafts are skipped after listing, so the scan may read up to this many times the pages
 * Max Conversations needs before it stops and reports the listing as capped.
 */
const SCAN_PAGE_MULTIPLIER = 3

const PersonSchema = z
  .object({
    id: z.number().nullable().optional(),
    type: z.string().nullable().optional(),
    first: z.string().nullable().optional(),
    last: z.string().nullable().optional(),
    name: z.string().nullable().optional(),
    email: z.string().nullable().optional(),
  })
  .passthrough()

const ConversationSchema = z
  .object({
    id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    number: z.number().nullable().optional(),
    threads: z.number().nullable().optional(),
    status: z.string().nullable().optional(),
    state: z.string().nullable().optional(),
    subject: z.string().nullable().optional(),
    preview: z.string().nullable().optional(),
    mailboxId: z.number().nullable().optional(),
    assignee: PersonSchema.nullable().optional(),
    primaryCustomer: PersonSchema.nullable().optional(),
    createdAt: z.string().nullable().optional(),
    closedAt: z.string().nullable().optional(),
    userUpdatedAt: z.string().nullable().optional(),
    customerWaitingSince: z
      .object({ time: z.string().nullable().optional() })
      .passthrough()
      .nullable()
      .optional(),
    tags: z
      .array(z.object({ tag: z.string().nullable().optional() }).passthrough())
      .nullable()
      .optional(),
    _links: z
      .object({ web: z.object({ href: z.string() }).passthrough().optional() })
      .passthrough()
      .optional(),
  })
  .passthrough()

const ThreadSchema = z
  .object({
    id: z.number(),
    type: z.string().nullable().optional(),
    state: z.string().nullable().optional(),
    body: z.string().nullable().optional(),
    createdAt: z.string().nullable().optional(),
    createdBy: PersonSchema.nullable().optional(),
  })
  .passthrough()

const LinksSchema = z
  .object({ next: z.object({ href: z.string() }).passthrough().optional() })
  .passthrough()
  .optional()

const ConversationPageSchema = z
  .object({
    _embedded: z
      .object({ conversations: z.array(ConversationSchema) })
      .passthrough()
      .optional(),
    _links: LinksSchema,
  })
  .passthrough()

const ThreadPageSchema = z
  .object({
    _embedded: z
      .object({ threads: z.array(ThreadSchema) })
      .passthrough()
      .optional(),
    _links: LinksSchema,
  })
  .passthrough()

type HelpScoutConversation = z.infer<typeof ConversationSchema>
type HelpScoutThread = z.infer<typeof ThreadSchema>

class HelpScoutHttpError extends Error {
  constructor(readonly status: number) {
    super(`Help Scout API request failed with status ${status}`)
    this.name = 'HelpScoutHttpError'
  }
}

async function helpScoutGet(
  path: string,
  accessToken: string,
  query: Record<string, string> = {},
  retryOptions?: RetryOptions
): Promise<unknown> {
  const url = new URL(`${HELPSCOUT_API_BASE}${path}`)
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value)
  const response = await fetchWithRetry(
    url.toString(),
    {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    },
    retryOptions
  )
  if (!response.ok) {
    await response.body?.cancel().catch(() => {})
    throw new HelpScoutHttpError(response.status)
  }
  return response.json()
}

function optionalId(value: unknown, label: string): string | undefined {
  const text =
    typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : ''
  if (!text) return undefined
  if (parseIdText(text) === null) throw new Error(`${label} must be a numeric Help Scout ID`)
  return text
}

function resolveStatus(sourceConfig: Record<string, unknown>): string {
  const status =
    typeof sourceConfig.status === 'string' && sourceConfig.status ? sourceConfig.status : 'all'
  if (!STATUSES.has(status))
    throw new Error('Conversation status must be all, active, pending, or closed')
  return status
}

function resolveTags(sourceConfig: Record<string, unknown>): string | undefined {
  if (typeof sourceConfig.tag !== 'string') return undefined
  const tags = sourceConfig.tag
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean)
  return tags.length > 0 ? tags.join(',') : undefined
}

function resolveMaxConversations(sourceConfig: Record<string, unknown>): number {
  if (sourceConfig.maxConversations === undefined || sourceConfig.maxConversations === '') {
    return DEFAULT_MAX_CONVERSATIONS
  }
  const parsed = Number(sourceConfig.maxConversations)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_CONVERSATIONS_LIMIT) {
    throw new Error(`Max Conversations must be a whole number from 1 to ${MAX_CONVERSATIONS_LIMIT}`)
  }
  return parsed
}

function personName(person: z.infer<typeof PersonSchema> | null | undefined): string {
  if (!person) return 'Unknown'
  const name = [person.first, person.last].filter((part) => part?.trim()).join(' ')
  return (
    name ||
    person.name?.trim() ||
    person.email ||
    (person.type === 'customer' ? 'Customer' : 'Help Scout user')
  )
}

function conversationMetadata(conversation: HelpScoutConversation): Record<string, unknown> {
  return {
    number: conversation.number ?? null,
    status: conversation.status ?? null,
    mailboxId: conversation.mailboxId ?? null,
    tags: (conversation.tags ?? []).map((tag) => tag.tag).filter(Boolean),
    customerEmail: conversation.primaryCustomer?.email ?? null,
    assignee: conversation.assignee ? personName(conversation.assignee) : null,
    createdAt: conversation.createdAt ?? null,
    closedAt: conversation.closedAt ?? null,
    updatedAt: lastActivityAt(conversation),
    threadCount: conversation.threads ?? null,
  }
}

/**
 * Help Scout exposes no modified-at field on a conversation, so the latest of its activity
 * timestamps stands in for it.
 */
function lastActivityAt(conversation: HelpScoutConversation): string | null {
  const times = [
    conversation.userUpdatedAt,
    conversation.customerWaitingSince?.time,
    conversation.closedAt,
    conversation.createdAt,
  ].filter((time): time is string => typeof time === 'string' && time !== '')
  return times.sort(compareStrings).at(-1) ?? null
}

/**
 * Change marker built only from listing fields, so unchanged conversations are never re-fetched.
 * Thread count, preview, and the activity timestamps move with new messages; the remaining
 * fields keep the indexed text and tags current. Fields are serialized as JSON so free text cannot
 * shift across field boundaries, and tags are sorted so list and single-conversation responses match.
 */
function conversationChangeMarker(conversation: HelpScoutConversation): string {
  return JSON.stringify([
    conversation.threads ?? '',
    conversation.status ?? '',
    conversation.userUpdatedAt ?? '',
    conversation.customerWaitingSince?.time ?? '',
    conversation.closedAt ?? '',
    conversation.subject ?? '',
    conversation.preview ?? '',
    conversation.mailboxId ?? '',
    conversation.assignee?.id ?? '',
    conversation.assignee ? personName(conversation.assignee) : '',
    conversation.primaryCustomer?.email ?? '',
    conversation.primaryCustomer ? personName(conversation.primaryCustomer) : '',
    (conversation.tags ?? []).map((tag) => tag.tag ?? '').sort(compareStrings),
  ])
}

/** Spam and unpublished drafts are not support history worth indexing. */
function isIndexedConversation(conversation: HelpScoutConversation): boolean {
  if (conversation.status === 'spam') return false
  return !conversation.state || conversation.state === 'published'
}

async function conversationToStub(
  conversation: HelpScoutConversation,
  includeNotes: boolean
): Promise<ExternalDocument> {
  const marker = await computeContentHash(conversationChangeMarker(conversation))
  return {
    externalId: String(conversation.id),
    title:
      conversation.subject?.trim() || `Conversation #${conversation.number ?? conversation.id}`,
    content: '',
    contentDeferred: true,
    mimeType: 'text/plain',
    sourceUrl:
      conversation._links?.web?.href ??
      `https://secure.helpscout.net/conversation/${conversation.id}`,
    contentHash: `helpscout:${conversation.id}:${includeNotes ? 'notes' : 'no-notes'}:${marker}`,
    metadata: conversationMetadata(conversation),
  }
}

/** Customer messages, agent replies, chats, phone calls, and (optionally) notes. */
function isIndexedThread(thread: HelpScoutThread, includeNotes: boolean): boolean {
  if (thread.state && thread.state !== 'published') return false
  if (thread.type === 'note') return includeNotes
  return thread.type !== 'lineitem'
}

const THREAD_LABELS: Record<string, string> = {
  customer: 'Customer',
  message: 'Agent reply',
  note: 'Internal note',
  chat: 'Chat',
  beaconchat: 'Beacon chat',
  phone: 'Phone',
  forwardparent: 'Forwarded',
  forwardchild: 'Forwarded',
}

function formatConversation(
  conversation: HelpScoutConversation,
  threads: HelpScoutThread[]
): string {
  const header = [
    `Subject: ${conversation.subject ?? '(no subject)'}`,
    `Status: ${conversation.status ?? 'unknown'}`,
    conversation.primaryCustomer ? `Customer: ${personName(conversation.primaryCustomer)}` : null,
  ]
    .filter(Boolean)
    .join('\n')

  const body = [...threads]
    .sort((a, b) => compareStrings(a.createdAt ?? '', b.createdAt ?? '') || a.id - b.id)
    .map((thread) => {
      const text = htmlToPlainText(thread.body ?? '').trim()
      if (!text) return null
      const label = THREAD_LABELS[thread.type ?? ''] ?? 'Message'
      const when = thread.createdAt ? ` (${thread.createdAt})` : ''
      return `${label} from ${personName(thread.createdBy)}${when}:\n${text}`
    })
    .filter(Boolean)

  return [header, ...body].join('\n\n').trim()
}

async function listThreads(
  conversationId: string,
  accessToken: string
): Promise<HelpScoutThread[]> {
  const threads: HelpScoutThread[] = []
  for (let page = 1; page <= MAX_THREAD_PAGES; page++) {
    const data = ThreadPageSchema.parse(
      await helpScoutGet(`/conversations/${conversationId}/threads`, accessToken, {
        page: String(page),
      })
    )
    threads.push(...(data._embedded?.threads ?? []))
    if (!data._links?.next) return threads
  }
  logger.warn('Help Scout thread listing truncated', { conversationId, pages: MAX_THREAD_PAGES })
  return threads
}

export const helpScoutConnector: ConnectorConfig = {
  ...helpScoutConnectorMeta,
  /** Each hydration costs two or three requests against an account-wide per-minute limit. */
  contentConcurrency: 3,

  listDocuments: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    _cursor?: string,
    syncContext?: Record<string, unknown>
  ): Promise<ExternalDocumentList> => {
    const mailboxId = optionalId(sourceConfig.mailboxId, 'Inbox ID')
    const status = resolveStatus(sourceConfig)
    const tag = resolveTags(sourceConfig)
    const maxConversations = resolveMaxConversations(sourceConfig)
    const includeNotes = sourceConfig.includeNotes !== 'exclude'

    const seen = new Set<number>()
    const documents: ExternalDocument[] = []
    let capped = false
    let scanBudgetReached = false
    const maxPages = Math.ceil(maxConversations / CONVERSATIONS_PER_PAGE) * SCAN_PAGE_MULTIPLIER

    for (let page = 1; ; page++) {
      const query: Record<string, string> = {
        status,
        sortField: 'createdAt',
        sortOrder: 'desc',
        page: String(page),
      }
      if (mailboxId) query.mailbox = mailboxId
      if (tag) query.tag = tag
      const data = ConversationPageSchema.parse(
        await helpScoutGet('/conversations', accessToken, query)
      )
      for (const conversation of data._embedded?.conversations ?? []) {
        if (seen.has(conversation.id) || !isIndexedConversation(conversation)) continue
        if (documents.length >= maxConversations) {
          capped = true
          break
        }
        seen.add(conversation.id)
        documents.push(await conversationToStub(conversation, includeNotes))
      }
      if (capped || !data._links?.next) break
      if (documents.length >= maxConversations) {
        capped = true
        break
      }
      if (page >= maxPages) {
        capped = true
        scanBudgetReached = true
        break
      }
    }

    if (capped && syncContext) syncContext.listingCapped = true
    if (capped) {
      logger.warn(
        scanBudgetReached
          ? 'Help Scout listing stopped at its page scan budget'
          : 'Help Scout listing truncated by Max Conversations',
        { count: documents.length, maxConversations, maxPages }
      )
    } else {
      logger.info('Listed Help Scout conversations', { count: documents.length })
    }
    /**
     * Pages are numbered, so a conversation that leaves the filtered set mid-scan shifts later
     * ones up a page and one can be skipped even when the total stays the same. Absence from
     * this listing is therefore never treated as a deletion.
     */
    return { documents, hasMore: false, reconciliationSafe: false }
  },

  getDocument: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    externalId: string
  ): Promise<ExternalDocument | null> => {
    if (parseIdText(externalId) === null) return null
    const includeNotes = sourceConfig.includeNotes !== 'exclude'
    try {
      const conversation = ConversationSchema.parse(
        await helpScoutGet(`/conversations/${externalId}`, accessToken)
      )
      // A merged conversation redirects to the conversation it was merged into.
      if (!isIndexedConversation(conversation) || String(conversation.id) !== externalId) {
        return null
      }
      const threads = (await listThreads(externalId, accessToken)).filter((thread) =>
        isIndexedThread(thread, includeNotes)
      )
      const content = formatConversation(conversation, threads)
      if (!content.trim()) return null
      return {
        ...(await conversationToStub(conversation, includeNotes)),
        content,
        contentDeferred: false,
      }
    } catch (error) {
      if (error instanceof HelpScoutHttpError && error.status === 404) {
        logger.warn('Help Scout conversation not found', { externalId })
        return null
      }
      logger.error('Failed to get Help Scout conversation', {
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
    try {
      const mailboxId = optionalId(sourceConfig.mailboxId, 'Inbox ID')
      resolveStatus(sourceConfig)
      resolveMaxConversations(sourceConfig)
      if (mailboxId) {
        await helpScoutGet(`/mailboxes/${mailboxId}`, accessToken, {}, VALIDATE_RETRY_OPTIONS)
      } else {
        await helpScoutGet('/mailboxes', accessToken, {}, VALIDATE_RETRY_OPTIONS)
      }
      return { valid: true }
    } catch (error) {
      if (error instanceof HelpScoutHttpError) {
        if (error.status === 404) return { valid: false, error: 'Inbox not found in Help Scout' }
        if (error.status === 401 || error.status === 403) {
          return {
            valid: false,
            error:
              'Help Scout rejected the credential. Reconnect Help Scout and confirm the user has API access.',
          }
        }
        return { valid: false, error: `Help Scout returned HTTP ${error.status}` }
      }
      return { valid: false, error: toError(error).message }
    }
  },

  mapTags: (metadata: Record<string, unknown>): Record<string, unknown> => {
    const result: Record<string, unknown> = {}
    if (typeof metadata.status === 'string' && metadata.status) result.status = metadata.status
    const tags = joinTagArray(metadata.tags)
    if (tags) result.tags = tags
    if (typeof metadata.customerEmail === 'string' && metadata.customerEmail) {
      result.customerEmail = metadata.customerEmail
    }
    if (typeof metadata.assignee === 'string' && metadata.assignee)
      result.assignee = metadata.assignee
    const createdAt = parseTagDate(metadata.createdAt)
    if (createdAt) result.createdAt = createdAt
    const updatedAt = parseTagDate(metadata.updatedAt)
    if (updatedAt) result.updatedAt = updatedAt
    if (typeof metadata.threadCount === 'number' && Number.isFinite(metadata.threadCount)) {
      result.threadCount = metadata.threadCount
    }
    return result
  },
}
