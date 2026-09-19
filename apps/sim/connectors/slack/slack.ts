import { createHash } from 'node:crypto'
import { createLogger } from '@sim/logger'
import { sha256Hex } from '@sim/security/hash'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { isPlainRecord } from '@sim/utils/object'
import { truncate } from '@sim/utils/string'
import { LRUCache } from 'lru-cache'
import { readResponseJsonWithLimit } from '@/lib/core/utils/stream-limits'
import { fetchWithRetry } from '@/lib/knowledge/documents/secure-fetch.server'
import { isRateLimitError, VALIDATE_RETRY_OPTIONS } from '@/lib/knowledge/documents/utils'
import {
  slackConversationTypes as conversationTypes,
  readSlackConversationSetting as readConversationSetting,
} from '@/connectors/slack/config'
import { DEFAULT_MAX_MESSAGES, slackConnectorMeta } from '@/connectors/slack/meta'
import {
  ConnectorSourceError,
  type ConnectorSourceFailureCategory,
} from '@/connectors/source-error'
import type {
  AccessibleScopes,
  ConnectorConfig,
  ExternalDocument,
  ExternalDocumentList,
} from '@/connectors/types'
import {
  BoundedLines,
  CONNECTOR_TEXT_DOCUMENT_MAX_BYTES,
  ConnectorFileTooLargeError,
  markSkipped,
  parseDefaultedUnlimitedSafeInteger,
  parseMultiValue,
  parseTagDate,
} from '@/connectors/utils'

const logger = createLogger('SlackConnector')
const SLACK_API_BASE = 'https://slack.com/api'
const PAGE_SIZE = 200
const MAX_RESPONSE_BYTES = 16 * 1024 * 1024
const MAX_CURSOR_BYTES = 256 * 1024
const MAX_THREAD_PAGES = 200
const MAX_USERNAME_CACHE_ENTRIES = 2000
const MAX_CHANNEL_CACHE_ENTRIES = 2000
const MAX_ROOT_VERSION_CACHE_ENTRIES = 50_000
/** Conversation pages read when resolving a caller's reachable channels; each proves access on its own. */
const MAX_SCOPE_CHANNEL_PAGES = 100
/**
 * Threads with activity this recent are reread on every listing. A root reports new
 * replies and its own edits, but not an edit or deletion of an existing reply, which in
 * practice happens while a thread is active.
 */
const ACTIVE_THREAD_REFRESH_SECONDS = 7 * 24 * 60 * 60
/**
 * Every quiet thread is also reread once in this many days, a fixed share of them each
 * day, so a reply edit on a thread that has gone quiet is picked up without rereading
 * the whole workspace at once.
 */
const QUIET_THREAD_REFRESH_DAYS = 28
const DAY_MS = 24 * 60 * 60 * 1000
const TIMESTAMP_PATTERN = /^\d{1,16}\.\d{1,6}$/
const CHANNEL_ID_PATTERN = /^[CGD][A-Z0-9]+$/
const TEAM_ID_PATTERN = /^T[A-Z0-9]+$/

const SLACK_NOISE_SUBTYPES = new Set([
  'channel_join',
  'channel_leave',
  'channel_topic',
  'channel_purpose',
  'channel_name',
  'channel_archive',
  'channel_unarchive',
  'group_join',
  'group_leave',
  'group_topic',
  'group_purpose',
  'group_name',
  'group_archive',
  'group_unarchive',
  'pinned_item',
  'unpinned_item',
  'bot_add',
  'bot_remove',
  'message_deleted',
  'tombstone',
  'ekm_access_denied',
])

interface SlackMessage {
  type: string
  user?: string
  username?: string
  text?: string
  ts: string
  thread_ts?: string
  subtype?: string
  reply_count?: number
  latest_reply?: string
  edited?: { ts: string }
  attachments?: Record<string, unknown>[]
  blocks?: Record<string, unknown>[]
}

interface SlackChannel {
  id: string
  name: string
  is_archived?: boolean
  is_im?: boolean
  is_mpim?: boolean
  user?: string
}

interface SlackListingCursor {
  version: 4
  teamId: string
  latest: string
  channels: SlackChannel[]
  channelsComplete: boolean
  channelCursor?: string
  historyCursor?: string
  scanned: number
}

interface SlackCodeClassification {
  /** The HTTP status Slack would have used had it not answered 200 with an error envelope. */
  status: number
  category: ConnectorSourceFailureCategory
}

/**
 * Slack answers HTTP 200 with `ok: false` and a machine-readable code. Mapping
 * the known codes onto the shared failure categories lets the sync engine and
 * the stored document error tell a revoked token from a missing thread from a
 * throttle, instead of every envelope error reading as an unknown failure.
 */
const SLACK_CODE_CLASSIFICATIONS: ReadonlyArray<[ReadonlySet<string>, SlackCodeClassification]> = [
  [new Set(['ratelimited']), { status: 429, category: 'rate_limit' }],
  [
    new Set(['invalid_auth', 'token_revoked', 'token_expired', 'account_inactive', 'not_authed']),
    { status: 401, category: 'authorization' },
  ],
  [
    new Set(['missing_scope', 'access_denied', 'restricted_action', 'ekm_access_denied']),
    { status: 403, category: 'authorization' },
  ],
  [
    new Set([
      'channel_not_found',
      'not_in_channel',
      'channel_is_limited_access',
      'thread_not_found',
      'message_not_found',
    ]),
    { status: 404, category: 'source_unavailable' },
  ],
  [
    new Set(['service_unavailable', 'internal_error', 'fatal_error', 'request_timeout']),
    { status: 503, category: 'provider_unavailable' },
  ],
]

/** Unknown codes are treated as a rejected request; the status alone drives the diagnostic. */
const UNCLASSIFIED_SLACK_CODE: SlackCodeClassification = {
  status: 400,
  category: 'request_rejected',
}

function classifySlackCode(code: string): SlackCodeClassification {
  for (const [codes, classification] of SLACK_CODE_CLASSIFICATIONS) {
    if (codes.has(code)) return classification
  }
  return UNCLASSIFIED_SLACK_CODE
}

/** Slack's HTTP-200 errors still retain their machine-readable provider code. */
class SlackApiError extends ConnectorSourceError {
  readonly code: string
  readonly method: string
  readonly headers?: Headers
  readonly rateLimited: boolean
  constructor(code: string, method: string, headers?: Headers) {
    const { status, category } = classifySlackCode(code)
    super(`Slack ${method} failed: ${code}`, status, category)
    this.name = 'SlackApiError'
    this.code = code
    this.method = method
    this.headers = headers
    this.rateLimited = code === 'ratelimited'
  }
}

async function slackApiGet(
  method: string,
  accessToken: string,
  params: Record<string, string>,
  retryOptions?: Parameters<typeof fetchWithRetry>[2]
): Promise<Record<string, unknown>> {
  const response = await fetchWithRetry(
    `${SLACK_API_BASE}/${method}?${new URLSearchParams(params).toString()}`,
    { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' } },
    retryOptions
  )
  /** Retries are exhausted by now; the status must survive so the failure can be classified. */
  if (!response.ok) {
    throw new ConnectorSourceError(
      `Slack ${method} failed with HTTP ${response.status}`,
      response.status
    )
  }
  const data = await readResponseJsonWithLimit(response, {
    maxBytes: MAX_RESPONSE_BYTES,
    label: `Slack ${method} response`,
  })
  if (!isPlainRecord(data) || typeof data.ok !== 'boolean') {
    throw new Error(`Slack ${method} returned an invalid response`)
  }
  if (!data.ok)
    throw new SlackApiError(
      typeof data.error === 'string' ? data.error : 'unknown_error',
      method,
      response.headers
    )
  return data
}

function readChannels(value: unknown): SlackChannel[] {
  if (!Array.isArray(value) || value.length > PAGE_SIZE) {
    throw new Error('Slack returned an invalid channel page')
  }
  return value.map((channel) => {
    if (
      !isPlainRecord(channel) ||
      typeof channel.id !== 'string' ||
      !CHANNEL_ID_PATTERN.test(channel.id) ||
      (channel.is_im === true
        ? typeof channel.user !== 'string' ||
          !/^[UW][A-Z0-9]+$/.test(channel.user) ||
          !channel.id.startsWith('D')
        : typeof channel.name !== 'string' || channel.id.startsWith('D'))
    ) {
      throw new Error('Slack returned an invalid channel')
    }
    return {
      id: channel.id,
      /** DM peer labels depend on the caller; indexed text must be identical for every participant. */
      name:
        channel.is_im === true
          ? 'Direct message'
          : channel.is_mpim === true
            ? 'Group direct message'
            : String(channel.name),
      is_archived: channel.is_archived === true,
      is_im: channel.is_im === true,
      is_mpim: channel.is_mpim === true,
      ...(channel.is_im === true ? { user: String(channel.user) } : {}),
    }
  })
}

function readMessages(value: unknown): SlackMessage[] {
  if (!Array.isArray(value) || value.length > PAGE_SIZE) {
    throw new Error('Slack returned an invalid message page')
  }
  return value.map((message) => {
    if (
      !isPlainRecord(message) ||
      typeof message.ts !== 'string' ||
      !TIMESTAMP_PATTERN.test(message.ts) ||
      message.type !== 'message'
    ) {
      throw new Error('Slack returned an invalid message')
    }
    if (
      message.thread_ts !== undefined &&
      (typeof message.thread_ts !== 'string' || !TIMESTAMP_PATTERN.test(message.thread_ts))
    ) {
      throw new Error('Slack returned an invalid thread timestamp')
    }
    return {
      type: 'message',
      ts: message.ts,
      text: typeof message.text === 'string' ? message.text : undefined,
      user: typeof message.user === 'string' ? message.user : undefined,
      username: typeof message.username === 'string' ? message.username : undefined,
      subtype: typeof message.subtype === 'string' ? message.subtype : undefined,
      thread_ts: typeof message.thread_ts === 'string' ? message.thread_ts : undefined,
      reply_count: typeof message.reply_count === 'number' ? message.reply_count : undefined,
      latest_reply:
        typeof message.latest_reply === 'string' && TIMESTAMP_PATTERN.test(message.latest_reply)
          ? message.latest_reply
          : undefined,
      edited:
        isPlainRecord(message.edited) && typeof message.edited.ts === 'string'
          ? { ts: message.edited.ts }
          : undefined,
      attachments: Array.isArray(message.attachments)
        ? message.attachments.filter(isPlainRecord)
        : undefined,
      blocks: Array.isArray(message.blocks) ? message.blocks.filter(isPlainRecord) : undefined,
    }
  })
}

/** A missing collection/cursor must never be mistaken for a successful empty listing. */
function nextCursor(data: Record<string, unknown>, previous?: string): string | undefined {
  const metadata = data.response_metadata
  if (metadata !== undefined && !isPlainRecord(metadata)) {
    throw new Error('Slack returned invalid pagination metadata')
  }
  const raw = isPlainRecord(metadata) ? metadata.next_cursor : undefined
  if (raw !== undefined && typeof raw !== 'string')
    throw new Error('Slack returned an invalid cursor')
  const cursor = typeof raw === 'string' ? raw.trim() || undefined : undefined
  if (cursor && (cursor === previous || cursor.length > 8192)) {
    throw new Error('Slack pagination did not advance')
  }
  if (data.has_more === true && !cursor) throw new Error('Slack omitted a continuation cursor')
  return cursor
}

function readStartDate(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error('Earliest message date must be YYYY-MM-DD')
  }
  const date = new Date(`${value}T00:00:00.000Z`)
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error('Earliest message date must be a valid calendar date')
  }
  return String(date.getTime() / 1000)
}

function includeArchived(sourceConfig: Record<string, unknown>): boolean {
  const value = sourceConfig.includeArchived
  if (value === undefined || value === null || value === '' || value === true || value === 'true')
    return true
  if (value === false || value === 'false') return false
  throw new Error('Archived channels must be Include or Exclude')
}

function channelMatches(channel: SlackChannel, values: string[]): boolean {
  return values.some(
    (value) =>
      value.trim().replace(/^#/, '') === channel.id ||
      value.trim().replace(/^#/, '') === channel.name
  )
}

function channelIncluded(channel: SlackChannel, sourceConfig: Record<string, unknown>): boolean {
  const directMessage = channel.is_im || channel.is_mpim
  if (
    directMessage
      ? !readConversationSetting(sourceConfig.includeDirectMessages, false)
      : !readConversationSetting(sourceConfig.includeChannels, true)
  )
    return false
  const included = parseMultiValue(sourceConfig.channel)
  return (
    (includeArchived(sourceConfig) || !channel.is_archived) &&
    (directMessage || included.length === 0 || channelMatches(channel, included)) &&
    !channelMatches(channel, parseMultiValue(sourceConfig.excludeChannels))
  )
}

interface SlackWorkspace {
  teamId: string
  /** The workspace's web address, from which message links are built; absent when Slack omits it. */
  url?: string
}

async function resolveWorkspace(
  accessToken: string,
  syncContext?: Record<string, unknown>
): Promise<SlackWorkspace> {
  const cached = syncContext?._slackWorkspace
  if (isPlainRecord(cached) && typeof cached.teamId === 'string') {
    return { teamId: cached.teamId, ...(typeof cached.url === 'string' ? { url: cached.url } : {}) }
  }
  const data = await slackApiGet('auth.test', accessToken, {})
  if (typeof data.team_id !== 'string' || !TEAM_ID_PATTERN.test(data.team_id)) {
    throw new Error('Slack did not identify the workspace for this credential')
  }
  const workspace: SlackWorkspace = { teamId: data.team_id }
  if (typeof data.url === 'string') {
    try {
      const url = new URL(data.url)
      if (url.protocol === 'https:' && url.hostname.endsWith('.slack.com'))
        workspace.url = `${url.origin}/`
    } catch {
      /** Links fall back to `chat.getPermalink` when the address is unusable. */
    }
  }
  if (syncContext) syncContext._slackWorkspace = workspace
  return workspace
}

function encodeCursor(state: SlackListingCursor): string {
  const json = JSON.stringify(state)
  if (Buffer.byteLength(json) > MAX_CURSOR_BYTES)
    throw new Error('Slack listing cursor is too large')
  return Buffer.from(json).toString('base64url')
}

function decodeCursor(cursor: string): SlackListingCursor {
  if (cursor.length > MAX_CURSOR_BYTES * 2) throw new Error('Slack listing cursor is too large')
  const value: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
  if (
    !isPlainRecord(value) ||
    value.version !== 4 ||
    typeof value.teamId !== 'string' ||
    !TEAM_ID_PATTERN.test(value.teamId) ||
    typeof value.latest !== 'string' ||
    !/^\d+(\.\d+)?$/.test(value.latest) ||
    typeof value.channelsComplete !== 'boolean' ||
    typeof value.scanned !== 'number' ||
    !Number.isSafeInteger(value.scanned) ||
    value.scanned < 0 ||
    (value.channelCursor !== undefined && typeof value.channelCursor !== 'string') ||
    (value.historyCursor !== undefined && typeof value.historyCursor !== 'string')
  ) {
    throw new Error('Invalid Slack listing cursor; restart the sync')
  }
  return {
    version: 4,
    teamId: value.teamId,
    latest: value.latest,
    channels: readChannels(value.channels),
    channelsComplete: value.channelsComplete,
    channelCursor: value.channelCursor,
    historyCursor: value.historyCursor,
    scanned: value.scanned,
  }
}

function finishPage(
  state: SlackListingCursor,
  documents: ExternalDocument[]
): ExternalDocumentList {
  const hasMore = state.channels.length > 0 || !state.channelsComplete
  return { documents, hasMore, nextCursor: hasMore ? encodeCursor(state) : undefined }
}

/** A new listing nonce forces reply hydration for an active thread, whose reply edits its root omits. */
function listingToken(syncContext?: Record<string, unknown>): string {
  if (typeof syncContext?.syncRunId === 'string') return syncContext.syncRunId
  if (typeof syncContext?._slackListingToken === 'string') return syncContext._slackListingToken
  const token = generateId()
  if (syncContext) syncContext._slackListingToken = token
  return token
}

function documentId(teamId: string, channelId: string, ts: string): string {
  return `${channelScope(teamId, channelId)}${ts}`
}

/** One page of the conversations a listing covers, under the connector's inclusion rules. */
async function listChannelPage(
  accessToken: string,
  sourceConfig: Record<string, unknown>,
  cursor?: string
): Promise<{ channels: SlackChannel[]; nextCursor?: string }> {
  const page = await slackApiGet('conversations.list', accessToken, {
    types: conversationTypes(sourceConfig),
    limit: String(PAGE_SIZE),
    exclude_archived: String(!includeArchived(sourceConfig)),
    ...(cursor ? { cursor } : {}),
  })
  return {
    channels: readChannels(page.channels).filter((channel) =>
      channelIncluded(channel, sourceConfig)
    ),
    nextCursor: nextCursor(page, cursor),
  }
}

/** Every thread of one conversation shares this external-id prefix. */
function channelScope(teamId: string, channelId: string): string {
  return `slack:v4:${teamId}:${channelId}:`
}

/**
 * What a thread's root says about its text: the conversation name the text is headed
 * with, the root's own edit, and the replies it has received. Unchanged, the thread
 * needs no rereading unless it is still active.
 */
function rootVersion(channel: SlackChannel, message: SlackMessage): string {
  return sha256Hex(
    JSON.stringify([
      channel.name,
      message.edited?.ts ?? '',
      message.reply_count ?? 0,
      message.latest_reply ?? '',
    ])
  ).slice(0, 32)
}

/** The day, of every {@link QUIET_THREAD_REFRESH_DAYS}, on which a quiet thread is reread. */
export function slackRollingRefreshDay(externalId: string): number {
  return (
    createHash('sha256').update(externalId).digest().readUInt32BE(0) % QUIET_THREAD_REFRESH_DAYS
  )
}

function dueForRollingRefresh(externalId: string, now: number): boolean {
  return slackRollingRefreshDay(externalId) === Math.floor(now / DAY_MS) % QUIET_THREAD_REFRESH_DAYS
}

function lastRootActivity(message: SlackMessage): number {
  return Math.max(
    Number(message.ts),
    Number(message.latest_reply ?? 0),
    Number(message.edited?.ts ?? 0)
  )
}

/**
 * A listed thread is identified by its root version alone; a hydrated one by its
 * version and the hash of its text. Earlier listings stored only the text hash.
 */
type SlackContentHash =
  | { kind: 'listed'; version: string }
  | { kind: 'hydrated'; version?: string; text: string }

const LISTED_HASH = /^slack-thread:v5:([0-9a-f]{32})$/
const HYDRATED_HASH = /^slack-thread:v5:([0-9a-f]{32}):([0-9a-f]{64})$/
const LEGACY_HYDRATED_HASH = /^slack-content:v4:([0-9a-f]{64})$/

function parseContentHash(hash: string): SlackContentHash | null {
  const listed = LISTED_HASH.exec(hash)
  if (listed) return { kind: 'listed', version: listed[1] }
  const hydrated = HYDRATED_HASH.exec(hash)
  if (hydrated) return { kind: 'hydrated', version: hydrated[1], text: hydrated[2] }
  const legacy = LEGACY_HYDRATED_HASH.exec(hash)
  if (legacy) return { kind: 'hydrated', text: legacy[1] }
  return null
}

/**
 * A quiet thread whose root version matches the stored one is current without being
 * reread. A reread thread whose text matches is current under its new hash. A listing
 * that asks for a reread carries a nonce, which parses as nothing and is always stale.
 */
function matchContentHash(candidate: string, stored: string): 'current' | 'equivalent' | 'stale' {
  const next = parseContentHash(candidate)
  const previous = parseContentHash(stored)
  if (!next || previous?.kind !== 'hydrated') return 'stale'
  if (next.kind === 'listed') return previous.version === next.version ? 'current' : 'stale'
  return previous.text === next.text ? 'equivalent' : 'stale'
}

/** A bounded per-run cache kept on the sync context, so nothing outlives the run. */
function contextCache<V extends {}>(
  syncContext: Record<string, unknown> | undefined,
  key: string,
  max: number
): LRUCache<string, V> | undefined {
  if (!syncContext) return undefined
  const existing = syncContext[key]
  if (existing instanceof LRUCache) return existing as LRUCache<string, V>
  const cache = new LRUCache<string, V>({ max })
  syncContext[key] = cache
  return cache
}

/** The versions a listing saw, so each thread it hydrates is stored under that version. */
function rootVersions(syncContext?: Record<string, unknown>) {
  return contextCache<string>(syncContext, '_slackRootVersions', MAX_ROOT_VERSION_CACHE_ENTRIES)
}

/** One `conversations.info` per conversation per run, shared by concurrent hydrations. */
function readChannelInfo(
  accessToken: string,
  channelId: string,
  syncContext?: Record<string, unknown>
): Promise<SlackChannel> {
  const cache = contextCache<Promise<SlackChannel>>(
    syncContext,
    '_slackChannelInfo',
    MAX_CHANNEL_CACHE_ENTRIES
  )
  const cached = cache?.get(channelId)
  if (cached) return cached
  const pending = slackApiGet('conversations.info', accessToken, { channel: channelId }).then(
    (info) => readChannels([info.channel])[0]
  )
  cache?.set(channelId, pending)
  pending.catch(() => cache?.delete(channelId))
  return pending
}

function messageTitle(channel: SlackChannel, message: SlackMessage): string {
  const text = extractMessageContent(message).replace(/\s+/g, ' ').trim()
  return `${channel.is_im || channel.is_mpim ? '' : '#'}${channel.name}: ${truncate(text || 'Thread', 160)}`
}

async function resolveUserName(
  accessToken: string,
  userId: string,
  syncContext?: Record<string, unknown>
): Promise<string> {
  const cache = contextCache<string>(syncContext, '_slackUserCache', MAX_USERNAME_CACHE_ENTRIES)
  const cached = cache?.get(userId)
  if (cached !== undefined) return cached
  try {
    const data = await slackApiGet('users.info', accessToken, { user: userId })
    const user = isPlainRecord(data.user) ? data.user : {}
    const profile = isPlainRecord(user.profile) ? user.profile : {}
    const name = [profile.display_name, user.real_name, user.name].find(
      (value) => typeof value === 'string' && value
    )
    const result = typeof name === 'string' ? name : userId
    cache?.set(userId, result)
    return result
  } catch (error) {
    if (isRateLimitError(error)) throw error
    logger.warn('Failed to resolve Slack author', { userId, error: getErrorMessage(error) })
    return userId
  }
}

/**
 * Pulls user-visible text from a Slack message's `text`, legacy `attachments`,
 * and Block Kit `blocks`. Apps like GitHub typically post a short `text`
 * summary with the actual PR/issue content inside attachments or blocks, so
 * reading `text` alone drops the meaningful body.
 */
function extractMessageContent(msg: SlackMessage): string {
  const parts: string[] = []

  for (const attachment of msg.attachments ?? []) {
    for (const key of ['pretext', 'author_name', 'title', 'text', 'footer'] as const) {
      const v = attachment[key]
      if (typeof v === 'string' && v.trim()) parts.push(v)
    }
    const fields = attachment.fields
    if (Array.isArray(fields)) {
      for (const f of fields) {
        if (!f || typeof f !== 'object') continue
        const fo = f as Record<string, unknown>
        const title = typeof fo.title === 'string' ? fo.title : ''
        const value = typeof fo.value === 'string' ? fo.value : ''
        if (title && value) parts.push(`${title}: ${value}`)
        else if (title || value) parts.push(title || value)
      }
    }
    /**
     * Attachments may also embed Block Kit blocks
     * (https://docs.slack.dev/legacy/legacy-messaging/legacy-secondary-message-attachments).
     * Apps like GitHub put the bulk of the PR/issue body inside attachment.blocks.
     */
    const nestedBlocks = attachment.blocks
    if (Array.isArray(nestedBlocks)) {
      for (const block of nestedBlocks) {
        const blockParts: string[] = []
        walkBlockText(block, blockParts)
        if (blockParts.length > 0) parts.push(blockParts.join(' '))
      }
    }
  }

  for (const block of msg.blocks ?? []) {
    const blockParts: string[] = []
    walkBlockText(block, blockParts)
    if (blockParts.length > 0) parts.push(blockParts.join(' '))
  }

  const body = parts.filter((part) => part.trim().length > 0).join('\n')
  const fallback = msg.text?.trim()
  if (!fallback || fallback === body.trim() || parts.some((part) => part.trim() === fallback)) {
    return body
  }
  return body ? `${fallback}\n${body}` : fallback
}

/**
 * Recursively walks Block Kit nodes pulling leaf text. Covers section
 * (`text` + `fields` + `accessory`), header (`text`), context
 * (`elements[].text`/`alt_text`), image blocks (`alt_text` + `title`), and
 * rich_text (nested `elements[].elements[]`). Link nodes without text fall
 * back to their URL; emoji nodes render as `:name:`; broadcast leafs render
 * as `@here`/`@channel`/`@everyone`; date leafs render their `fallback`;
 * user/channel/usergroup mentions render their referenced id.
 */
function walkBlockText(node: unknown, out: string[]): void {
  if (!node || typeof node !== 'object') return
  const n = node as Record<string, unknown>
  if (typeof n.text === 'string') {
    out.push(n.text)
  } else if (n.text && typeof n.text === 'object') {
    walkBlockText(n.text, out)
  }
  if (Array.isArray(n.fields)) {
    for (const f of n.fields) walkBlockText(f, out)
  }
  if (Array.isArray(n.elements)) {
    for (const e of n.elements) walkBlockText(e, out)
  }
  /**
   * Section blocks expose a single side accessory (button, image, overflow
   * menu) that frequently carries user-visible labels.
   */
  if (n.accessory && typeof n.accessory === 'object') {
    walkBlockText(n.accessory, out)
  }
  if (typeof n.alt_text === 'string' && n.alt_text.trim()) {
    out.push(n.alt_text)
  }
  if (n.type === 'link' && typeof n.url === 'string' && typeof n.text !== 'string') {
    out.push(n.url)
  }
  if (n.type === 'emoji' && typeof n.name === 'string') {
    out.push(`:${n.name}:`)
  }
  if (n.type === 'broadcast' && typeof n.range === 'string') {
    out.push(`@${n.range}`)
  }
  if (n.type === 'user' && typeof n.user_id === 'string') {
    out.push(`<@${n.user_id}>`)
  }
  if (n.type === 'channel' && typeof n.channel_id === 'string') {
    out.push(`<#${n.channel_id}>`)
  }
  if (n.type === 'usergroup' && typeof n.usergroup_id === 'string') {
    out.push(`<!subteam^${n.usergroup_id}>`)
  }
  if (n.type === 'date' && typeof n.fallback === 'string') {
    out.push(n.fallback)
  }
}

/**
 * One history page per call keeps permission discovery bounded. The caller's
 * complete listing proves access to each root; no other member's channel
 * inventory is reused. A selected date is a root-date scope, not an activity
 * filter: replies to a root before that date remain outside the source.
 */
async function listDocuments(
  accessToken: string,
  sourceConfig: Record<string, unknown>,
  cursor?: string,
  syncContext?: Record<string, unknown>
): Promise<ExternalDocumentList> {
  const oldest = readStartDate(sourceConfig.startDate)
  const maxMessages = parseDefaultedUnlimitedSafeInteger(
    sourceConfig.maxMessages,
    DEFAULT_MAX_MESSAGES,
    'Max messages must be a non-negative safe integer'
  )
  const { teamId } = await resolveWorkspace(accessToken, syncContext)
  const state: SlackListingCursor = cursor
    ? decodeCursor(cursor)
    : {
        version: 4,
        teamId,
        latest: String(Date.now() / 1000),
        channels: [],
        channelsComplete: false,
        scanned: 0,
      }
  if (state.teamId !== teamId) throw new Error('Slack listing cursor belongs to another workspace')

  if (state.channels.length === 0 && !state.channelsComplete) {
    const page = await listChannelPage(accessToken, sourceConfig, state.channelCursor)
    state.channels = page.channels
    state.channelCursor = page.nextCursor
    state.channelsComplete = !page.nextCursor
  }
  const channel = state.channels[0]
  if (!channel) return finishPage(state, [])
  if (maxMessages > 0 && state.scanned >= maxMessages) {
    throw new Error('Invalid Slack listing cursor; restart the sync')
  }

  let history: Record<string, unknown>
  try {
    history = await slackApiGet('conversations.history', accessToken, {
      channel: channel.id,
      limit: String(maxMessages > 0 ? Math.min(PAGE_SIZE, maxMessages - state.scanned) : PAGE_SIZE),
      latest: state.latest,
      ...(oldest ? { oldest, inclusive: 'true' } : {}),
      ...(state.historyCursor ? { cursor: state.historyCursor } : {}),
    })
  } catch (error) {
    if (
      !(error instanceof SlackApiError) ||
      !['channel_not_found', 'not_in_channel', 'channel_is_limited_access'].includes(error.code)
    )
      throw error
    /** Earlier pages must not survive as a complete observation after access was lost mid-channel. */
    if (state.scanned > 0) throw error
    /** Losing an as-yet-unread channel is an authoritative removal for this caller. */
    state.channels.shift()
    state.scanned = 0
    state.historyCursor = undefined
    return finishPage(state, [])
  }
  const messages = readMessages(history.messages)
  const continuation = nextCursor(history, state.historyCursor)
  if (history.is_limited === true) {
    /** Retention/API restrictions provide only a partial view; do not infer deletions from it. */
    if (syncContext) syncContext.listingCapped = true
  }
  const seen = new Set<string>()
  const documents: ExternalDocument[] = []
  for (const message of messages) {
    if (message.subtype && SLACK_NOISE_SUBTYPES.has(message.subtype)) continue
    /** A broadcast reply is indexed with its original root, not as a second copy of the thread. */
    if (message.thread_ts && message.thread_ts !== message.ts) continue
    if (!extractMessageContent(message) && !(message.reply_count && message.reply_count > 0))
      continue
    if (oldest && Number(message.ts) < Number(oldest)) continue
    const externalId = documentId(teamId, channel.id, message.ts)
    if (seen.has(externalId)) continue
    seen.add(externalId)
    const version = rootVersion(channel, message)
    rootVersions(syncContext)?.set(externalId, version)
    const now = Date.now()
    const reread =
      syncContext?.fullSync === true ||
      now / 1000 - lastRootActivity(message) < ACTIVE_THREAD_REFRESH_SECONDS ||
      dueForRollingRefresh(externalId, now)
    documents.push({
      externalId,
      title: messageTitle(channel, message),
      content: '',
      contentDeferred: true,
      /**
       * A thread with no text gains some through a new reply, which changes its root version,
       * or a reply edit, which the active and rolling rereads pick up.
       */
      skippedRetryPolicy: 'source-change',
      estimatedBytes: CONNECTOR_TEXT_DOCUMENT_MAX_BYTES,
      mimeType: 'text/plain',
      contentHash: reread
        ? `slack-thread:v5:${version}:refresh:${listingToken(syncContext)}`
        : `slack-thread:v5:${version}`,
      metadata: {
        channelName: channel.name,
        channelId: channel.id,
        rootTs: message.ts,
        teamId,
        conversationType: channel.is_im ? 'im' : channel.is_mpim ? 'mpim' : 'channel',
      },
    })
  }
  state.scanned += messages.length
  const capped = maxMessages > 0 && state.scanned >= maxMessages && Boolean(continuation)
  if (capped && syncContext) syncContext.listingCapped = true
  if (!continuation || capped) {
    state.channels.shift()
    state.scanned = 0
    state.historyCursor = undefined
  } else {
    state.historyCursor = continuation
  }
  return finishPage(state, documents)
}

/**
 * Hydrates every message in a thread. The stored hash pairs the root version the
 * listing saw with the hash of the text, so a quiet thread is not reread while its
 * version holds and a reread thread's embeddings are replaced only when its text
 * changed. Partial failures throw rather than publishing a root while silently
 * dropping its replies.
 */
async function getDocument(
  accessToken: string,
  sourceConfig: Record<string, unknown>,
  externalId: string,
  syncContext?: Record<string, unknown>
): Promise<ExternalDocument | null> {
  const match = /^slack:v4:(T[A-Z0-9]+):([CGD][A-Z0-9]+):(\d{1,16}\.\d{1,6})$/.exec(externalId)
  /** Legacy channel documents are retired through the next successful listing reconciliation. */
  if (!match) return null
  const [, teamId, channelId, rootTs] = match
  const workspace = await resolveWorkspace(accessToken, syncContext)
  if (workspace.teamId !== teamId) {
    throw new Error('Slack document belongs to another workspace')
  }
  const oldest = readStartDate(sourceConfig.startDate)
  if (oldest && Number(rootTs) < Number(oldest)) return null
  try {
    const channel = await readChannelInfo(accessToken, channelId, syncContext)
    if (!channelIncluded(channel, sourceConfig)) return null
    const lines = new BoundedLines(CONNECTOR_TEXT_DOCUMENT_MAX_BYTES)
    lines.pin(
      channel.is_im || channel.is_mpim
        ? `Conversation: ${channel.name}`
        : `Channel: #${channel.name}`,
      ''
    )
    let cursor: string | undefined
    let root: SlackMessage | undefined
    let lastActivity = rootTs
    let previousTs: string | undefined
    let exhausted = false
    for (let page = 0; page < MAX_THREAD_PAGES; page += 1) {
      const response = await slackApiGet('conversations.replies', accessToken, {
        channel: channelId,
        ts: rootTs,
        limit: String(PAGE_SIZE),
        ...(cursor ? { cursor } : {}),
      })
      const messages = readMessages(response.messages)
      if (response.is_limited === true) throw new Error('Slack returned only part of this thread')
      if (!root) {
        root = messages.find((message) => message.ts === rootTs)
        if (!root && messages.length > 0) throw new Error('Slack thread response omitted its root')
      }
      for (const message of messages) {
        if (message.ts !== rootTs && message.thread_ts !== rootTs) {
          throw new Error('Slack returned a message from a different thread')
        }
        if (previousTs && Number(message.ts) <= Number(previousTs)) {
          throw new Error('Slack thread pagination returned duplicate or unordered messages')
        }
        previousTs = message.ts
        if (Number(message.ts) > Number(lastActivity)) lastActivity = message.ts
        if (message.edited?.ts && Number(message.edited.ts) > Number(lastActivity))
          lastActivity = message.edited.ts
        if (message.subtype && SLACK_NOISE_SUBTYPES.has(message.subtype)) continue
        const content = extractMessageContent(message)
        if (!content) continue
        const author = message.user
          ? await resolveUserName(accessToken, message.user, syncContext)
          : message.username || 'unknown'
        if (
          !lines.push(
            `[${new Date(Number(message.ts) * 1000).toISOString()}] ${author}: ${content}`
          )
        ) {
          throw new ConnectorFileTooLargeError(CONNECTOR_TEXT_DOCUMENT_MAX_BYTES)
        }
      }
      const continuation = nextCursor(response, cursor)
      if (!continuation) {
        exhausted = true
        break
      }
      cursor = continuation
    }
    if (!exhausted) throw new Error(`Slack thread exceeds ${MAX_THREAD_PAGES} reply pages`)
    if (!root) return null
    const content = lines.count > 0 ? lines.join() : ''
    const listed = rootVersions(syncContext)
    const version = listed?.get(externalId) ?? rootVersion(channel, root)
    listed?.delete(externalId)
    const document: ExternalDocument = {
      externalId,
      title: messageTitle(channel, root),
      content,
      contentDeferred: false,
      mimeType: 'text/plain',
      contentHash: `slack-thread:v5:${version}:${sha256Hex(content)}`,
      metadata: {
        channelName: channel.name,
        channelId,
        conversationType: channel.is_im ? 'im' : channel.is_mpim ? 'mpim' : 'channel',
        rootTs,
        teamId,
        messageCount: lines.count,
        lastActivity: new Date(Number(lastActivity) * 1000).toISOString(),
      },
    }
    /** Only a fully read thread can authoritatively replace previously indexed text with a skip. */
    if (lines.count === 0) {
      return {
        ...markSkipped(document, 'Document contains no extractable text'),
        skippedExistingDisposition: 'replace',
      }
    }
    return { ...document, sourceUrl: await messageLink(accessToken, workspace, channelId, rootTs) }
  } catch (error) {
    if (
      error instanceof SlackApiError &&
      [
        'channel_not_found',
        'not_in_channel',
        'channel_is_limited_access',
        'thread_not_found',
        'message_not_found',
      ].includes(error.code)
    )
      return null
    throw error
  }
}

/**
 * The root's link, in the documented `archives/<channel>/p<ts>` form Slack's own
 * permalinks take, so a thread needs no `chat.getPermalink` round trip.
 */
async function messageLink(
  accessToken: string,
  workspace: SlackWorkspace,
  channelId: string,
  rootTs: string
): Promise<string> {
  if (workspace.url) return `${workspace.url}archives/${channelId}/p${rootTs.replace('.', '')}`
  const link = await slackApiGet('chat.getPermalink', accessToken, {
    channel: channelId,
    message_ts: rootTs,
  })
  if (typeof link.permalink !== 'string' || !link.permalink.startsWith('https://')) {
    throw new Error('Slack did not return a message permalink')
  }
  return link.permalink
}

/**
 * The conversations the caller can read, under the same inclusion rules as a listing,
 * as the external-id prefix of their threads. Access is granted per conversation, so
 * a conversation listed here proves access to every thread in it. Stopping at the page
 * cap reports the listing incomplete, so the conversations past it stay due for renewal.
 */
async function listAccessibleScopes(
  accessToken: string,
  sourceConfig: Record<string, unknown>,
  syncContext?: Record<string, unknown>
): Promise<AccessibleScopes> {
  const { teamId } = await resolveWorkspace(accessToken, syncContext)
  const prefixes: string[] = []
  let cursor: string | undefined
  for (let page = 0; page < MAX_SCOPE_CHANNEL_PAGES; page += 1) {
    const { channels, nextCursor: next } = await listChannelPage(accessToken, sourceConfig, cursor)
    for (const channel of channels) prefixes.push(channelScope(teamId, channel.id))
    cursor = next
    if (!cursor) break
  }
  return { prefixes, complete: !cursor }
}

export const slackConnector: ConnectorConfig = {
  isCredentialInvalidError: (error) =>
    error instanceof SlackApiError &&
    ['invalid_auth', 'token_revoked', 'token_expired', 'account_inactive'].includes(error.code),
  isListingCursorInvalidError: (error) =>
    error instanceof SlackApiError && error.code === 'invalid_cursor',
  ...slackConnectorMeta,
  listDocuments,
  getDocument,
  matchContentHash,
  listAccessibleScopes,
  validateConfig: async (accessToken, sourceConfig) => {
    try {
      readStartDate(sourceConfig.startDate)
      includeArchived(sourceConfig)
      parseDefaultedUnlimitedSafeInteger(
        sourceConfig.maxMessages,
        DEFAULT_MAX_MESSAGES,
        'Max messages must be a non-negative safe integer'
      )
      await slackApiGet(
        'conversations.list',
        accessToken,
        {
          types: conversationTypes(sourceConfig),
          limit: '1',
          exclude_archived: String(!includeArchived(sourceConfig)),
        },
        VALIDATE_RETRY_OPTIONS
      )
      return { valid: true }
    } catch (error) {
      return {
        valid: false,
        error: getErrorMessage(error, 'Failed to validate Slack configuration'),
      }
    }
  },
  mapTags: (metadata) => ({
    ...(typeof metadata.channelName === 'string' ? { channelName: metadata.channelName } : {}),
    ...(typeof metadata.messageCount === 'number' ? { messageCount: metadata.messageCount } : {}),
    ...(parseTagDate(metadata.lastActivity)
      ? { lastActivity: parseTagDate(metadata.lastActivity) }
      : {}),
  }),
}
