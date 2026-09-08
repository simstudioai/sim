import { createHash } from 'node:crypto'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { isPlainRecord } from '@sim/utils/object'
import { truncate } from '@sim/utils/string'
import { readResponseJsonWithLimit } from '@/lib/core/utils/stream-limits'
import {
  fetchWithRetry,
  isRateLimitError,
  VALIDATE_RETRY_OPTIONS,
} from '@/lib/knowledge/documents/utils'
import { DEFAULT_MAX_MESSAGES, slackConnectorMeta } from '@/connectors/slack/meta'
import type { ConnectorConfig, ExternalDocument, ExternalDocumentList } from '@/connectors/types'
import {
  BoundedLines,
  CONNECTOR_TEXT_DOCUMENT_MAX_BYTES,
  ConnectorFileTooLargeError,
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
const CHANNEL_TYPES = 'public_channel,private_channel'
const TIMESTAMP_PATTERN = /^\d{1,16}\.\d{1,6}$/
const CHANNEL_ID_PATTERN = /^[CG][A-Z0-9]+$/
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
  edited?: { ts: string }
  attachments?: Record<string, unknown>[]
  blocks?: Record<string, unknown>[]
}

interface SlackChannel {
  id: string
  name: string
  is_archived?: boolean
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

/** Slack's HTTP-200 errors still retain their machine-readable provider code. */
class SlackApiError extends Error {
  readonly rateLimited: boolean
  constructor(
    readonly code: string,
    readonly method: string,
    readonly headers?: Headers
  ) {
    super(`Slack ${method} failed: ${code}`)
    this.name = 'SlackApiError'
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
  if (!response.ok) throw new Error(`Slack ${method} failed with HTTP ${response.status}`)
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
      typeof channel.name !== 'string'
    ) {
      throw new Error('Slack returned an invalid channel')
    }
    return { id: channel.id, name: channel.name, is_archived: channel.is_archived === true }
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
  const included = parseMultiValue(sourceConfig.channel)
  return (
    (includeArchived(sourceConfig) || !channel.is_archived) &&
    (included.length === 0 || channelMatches(channel, included)) &&
    !channelMatches(channel, parseMultiValue(sourceConfig.excludeChannels))
  )
}

async function resolveTeamId(
  accessToken: string,
  syncContext?: Record<string, unknown>
): Promise<string> {
  const cached = syncContext?._slackTeamId
  if (typeof cached === 'string' && TEAM_ID_PATTERN.test(cached)) return cached
  const data = await slackApiGet('auth.test', accessToken, {})
  if (typeof data.team_id !== 'string' || !TEAM_ID_PATTERN.test(data.team_id)) {
    throw new Error('Slack did not identify the workspace for this credential')
  }
  if (syncContext) syncContext._slackTeamId = data.team_id
  return data.team_id
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

/** A new listing nonce forces reply hydration, because root metadata omits reply edits. */
function listingToken(syncContext?: Record<string, unknown>): string {
  if (typeof syncContext?.syncRunId === 'string') return syncContext.syncRunId
  if (typeof syncContext?._slackListingToken === 'string') return syncContext._slackListingToken
  const token = generateId()
  if (syncContext) syncContext._slackListingToken = token
  return token
}

function documentId(teamId: string, channelId: string, ts: string): string {
  return `slack:v4:${teamId}:${channelId}:${ts}`
}

function messageTitle(channel: SlackChannel, message: SlackMessage): string {
  const text = extractMessageContent(message).replace(/\s+/g, ' ').trim()
  return `#${channel.name}: ${truncate(text || 'Thread', 160)}`
}

async function resolveUserName(
  accessToken: string,
  userId: string,
  syncContext?: Record<string, unknown>
): Promise<string> {
  const cache = syncContext?._slackUserCache
  if (cache instanceof Map && cache.has(userId)) return cache.get(userId) as string
  try {
    const data = await slackApiGet('users.info', accessToken, { user: userId })
    const user = isPlainRecord(data.user) ? data.user : {}
    const profile = isPlainRecord(user.profile) ? user.profile : {}
    const name = [profile.display_name, user.real_name, user.name].find(
      (value) => typeof value === 'string' && value
    )
    const result = typeof name === 'string' ? name : userId
    if (syncContext) {
      const names = cache instanceof Map ? cache : new Map<string, string>()
      if (names.size < MAX_USERNAME_CACHE_ENTRIES) names.set(userId, result)
      syncContext._slackUserCache = names
    }
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
  if (msg.text) parts.push(msg.text)

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

  return parts.filter((s) => s.trim().length > 0).join('\n')
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
  const archives = includeArchived(sourceConfig)
  const maxMessages = parseDefaultedUnlimitedSafeInteger(
    sourceConfig.maxMessages,
    DEFAULT_MAX_MESSAGES,
    'Max messages must be a non-negative safe integer'
  )
  const teamId = await resolveTeamId(accessToken, syncContext)
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
    const page = await slackApiGet('conversations.list', accessToken, {
      types: CHANNEL_TYPES,
      limit: String(PAGE_SIZE),
      exclude_archived: String(!archives),
      ...(state.channelCursor ? { cursor: state.channelCursor } : {}),
    })
    const continuation = nextCursor(page, state.channelCursor)
    state.channels = readChannels(page.channels).filter((channel) =>
      channelIncluded(channel, sourceConfig)
    )
    state.channelCursor = continuation
    state.channelsComplete = !continuation
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
    documents.push({
      externalId,
      title: messageTitle(channel, message),
      content: '',
      contentDeferred: true,
      estimatedBytes: CONNECTOR_TEXT_DOCUMENT_MAX_BYTES,
      mimeType: 'text/plain',
      contentHash: `slack-listing:v4:${externalId}:${listingToken(syncContext)}`,
      metadata: { channelName: channel.name, channelId: channel.id, rootTs: message.ts, teamId },
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
 * Hydrates every message in a thread. Root latest_reply/reply_count cannot
 * detect an edit to an existing reply; every listed thread is reread, and the
 * text hash decides whether its embeddings need replacing. Partial failures
 * throw rather than publishing a root while silently dropping its replies.
 */
async function getDocument(
  accessToken: string,
  sourceConfig: Record<string, unknown>,
  externalId: string,
  syncContext?: Record<string, unknown>
): Promise<ExternalDocument | null> {
  const match = /^slack:v4:(T[A-Z0-9]+):([CG][A-Z0-9]+):(\d{1,16}\.\d{1,6})$/.exec(externalId)
  /** Legacy channel documents are retired through the next successful listing reconciliation. */
  if (!match) return null
  const [, teamId, channelId, rootTs] = match
  if ((await resolveTeamId(accessToken, syncContext)) !== teamId) {
    throw new Error('Slack document belongs to another workspace')
  }
  const oldest = readStartDate(sourceConfig.startDate)
  if (oldest && Number(rootTs) < Number(oldest)) return null
  try {
    const info = await slackApiGet('conversations.info', accessToken, { channel: channelId })
    const channel = readChannels([info.channel])[0]
    if (!channelIncluded(channel, sourceConfig)) return null
    const lines = new BoundedLines(CONNECTOR_TEXT_DOCUMENT_MAX_BYTES)
    lines.pin(`Channel: #${channel.name}`, '')
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
    if (!root || lines.count === 0) return null
    const link = await slackApiGet('chat.getPermalink', accessToken, {
      channel: channelId,
      message_ts: rootTs,
    })
    if (typeof link.permalink !== 'string' || !link.permalink.startsWith('https://')) {
      throw new Error('Slack did not return a message permalink')
    }
    const content = lines.join()
    return {
      externalId,
      title: messageTitle(channel, root),
      content,
      contentDeferred: false,
      mimeType: 'text/plain',
      sourceUrl: link.permalink,
      contentHash: `slack-content:v4:${createHash('sha256').update(content).digest('hex')}`,
      metadata: {
        channelName: channel.name,
        channelId,
        rootTs,
        teamId,
        messageCount: lines.count,
        lastActivity: new Date(Number(lastActivity) * 1000).toISOString(),
      },
    }
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

export const slackConnector: ConnectorConfig = {
  isCredentialInvalidError: (error) =>
    error instanceof SlackApiError &&
    ['invalid_auth', 'token_revoked', 'token_expired', 'account_inactive'].includes(error.code),
  isListingCursorInvalidError: (error) =>
    error instanceof SlackApiError && error.code === 'invalid_cursor',
  ...slackConnectorMeta,
  listDocuments,
  getDocument,
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
          types: CHANNEL_TYPES,
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
