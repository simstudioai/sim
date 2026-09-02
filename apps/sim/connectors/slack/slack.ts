import { createHash } from 'node:crypto'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { fetchWithRetry, VALIDATE_RETRY_OPTIONS } from '@/lib/knowledge/documents/utils'
import { DEFAULT_MAX_MESSAGES, slackConnectorMeta } from '@/connectors/slack/meta'
import type { ConnectorConfig, ExternalDocument, ExternalDocumentList } from '@/connectors/types'
import {
  BoundedLines,
  CONNECTOR_TEXT_DOCUMENT_MAX_BYTES,
  parseMultiValue,
  parseTagDate,
} from '@/connectors/utils'

const logger = createLogger('SlackConnector')

const SLACK_API_BASE = 'https://slack.com/api'
const MESSAGES_PER_PAGE = 200
/** Page size for `conversations.list`; Slack recommends staying well under its 1000 maximum. */
const CHANNELS_PER_PAGE = 200
/** The conversation kinds a channel listing walks; DMs need scopes the connector does not request. */
const LISTED_CHANNEL_TYPES = 'public_channel,private_channel'
/** `syncContext` key holding this run's listing token when the engine supplies no run id. */
const LISTING_TOKEN_KEY = '_slackListingToken'

/**
 * Message subtypes that carry no user-authored text (channel events, bot
 * lifecycle, etc.). Per https://api.slack.com/events/message every other
 * subtype — `bot_message`, `file_share`, `me_message`, `thread_broadcast`,
 * `reminder_add`, `file_comment`, etc. — can carry meaningful content.
 */
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
])

interface SlackMessage {
  type: string
  user?: string
  username?: string
  bot_id?: string
  text?: string
  ts: string
  subtype?: string
  edited?: { ts: string; user?: string }
  latest_reply?: string
  reply_count?: number
  attachments?: Record<string, unknown>[]
  blocks?: Record<string, unknown>[]
}

interface SlackChannel {
  id: string
  name: string
  topic?: { value: string }
  purpose?: { value: string }
  num_members?: number
}

interface SlackUser {
  id: string
  real_name?: string
  name: string
  profile?: {
    display_name?: string
    real_name?: string
  }
}

/**
 * Actionable hints for the Slack error codes a sync realistically hits. Without
 * them a failed sync surfaces only the raw code (e.g. `not_in_channel`), which
 * does not tell the user the fix is to invite the app to the channel.
 * Codes are documented per method, e.g.
 * https://docs.slack.dev/reference/methods/conversations.history/
 */
const SLACK_ERROR_HINTS: Record<string, string> = {
  not_in_channel: 'invite the Sim app to this channel',
  channel_not_found: 'the channel does not exist or the app cannot see it',
  is_archived: 'the channel is archived',
  missing_scope: 'the Slack credential is missing a required scope; reconnect it',
  invalid_auth: 'the Slack credential is no longer valid; reconnect it',
  account_inactive: 'the Slack credential is no longer valid; reconnect it',
  token_revoked: 'the Slack credential is no longer valid; reconnect it',
  ratelimited: 'Slack rate limit exceeded',
}

/**
 * Error thrown for a Slack `ok: false` envelope, carrying the machine-readable
 * `error` code so callers can branch on `channel_not_found` without string
 * matching.
 */
class SlackApiError extends Error {
  constructor(
    readonly code: string,
    readonly method: string
  ) {
    const hint = SLACK_ERROR_HINTS[code]
    super(`Slack API error on ${method}: ${code}${hint ? ` — ${hint}` : ''}`)
    this.name = 'SlackApiError'
  }
}

/**
 * Calls a Slack Web API method via GET with query params.
 * Slack returns HTTP 200 even for errors, so we check the `ok` field.
 */
async function slackApiGet(
  method: string,
  accessToken: string,
  params: Record<string, string>,
  retryOptions?: Parameters<typeof fetchWithRetry>[2]
): Promise<Record<string, unknown>> {
  const queryParams = new URLSearchParams(params)
  const url = `${SLACK_API_BASE}/${method}?${queryParams.toString()}`

  const response = await fetchWithRetry(
    url,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    },
    retryOptions
  )

  if (!response.ok) {
    throw new Error(`Slack API HTTP error: ${response.status}`)
  }

  const data = (await response.json()) as Record<string, unknown>

  if (!data.ok) {
    throw new SlackApiError((data.error as string) || 'unknown_error', method)
  }

  return data
}

/**
 * Resolves the configured message window, falling back to the default for
 * missing, non-numeric, or non-positive values.
 *
 * `validateConfig` rejects those inputs, but a config saved before validation
 * tightened (or edited out-of-band) would otherwise produce `NaN`/`0` here,
 * making `fetchChannelMessages` return zero messages. An empty document is
 * dropped from the listing, and the sync engine hard-deletes stored documents
 * absent from a listing — silently wiping every indexed channel.
 */
function resolveMaxMessages(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : DEFAULT_MAX_MESSAGES
}

/**
 * Resolves a user ID to a display name, using a cache stored in syncContext.
 */
async function resolveUserName(
  accessToken: string,
  userId: string,
  syncContext?: Record<string, unknown>
): Promise<string> {
  const cacheKey = '_slackUserCache'
  if (syncContext) {
    const cache = (syncContext[cacheKey] as Record<string, string>) ?? {}
    if (!syncContext[cacheKey]) {
      syncContext[cacheKey] = cache
    }
    if (cache[userId]) {
      return cache[userId]
    }
  }

  try {
    const data = await slackApiGet('users.info', accessToken, { user: userId })
    const user = data.user as SlackUser | undefined
    const displayName = user?.profile?.display_name || user?.real_name || user?.name || userId

    if (syncContext) {
      const cache = syncContext[cacheKey] as Record<string, string>
      cache[userId] = displayName
    }

    return displayName
  } catch (error) {
    logger.warn('Failed to resolve Slack user name', {
      userId,
      error: toError(error).message,
    })
    /**
     * Negative-cache only permanently unresolvable users. A deleted user
     * (`user_not_found`) can author hundreds of messages, each otherwise
     * costing another Tier 4 `users.info` request. Transient failures are not
     * cached so a later message can still resolve the real name.
     */
    if (syncContext && error instanceof SlackApiError && error.code === 'user_not_found') {
      const cache = syncContext[cacheKey] as Record<string, string>
      cache[userId] = userId
    }
    return userId
  }
}

/**
 * Formats a Slack timestamp (e.g. "1234567890.123456") into an ISO datetime string.
 */
function formatSlackTimestamp(ts: string): string {
  const seconds = Number.parseFloat(ts)
  return new Date(seconds * 1000).toISOString()
}

/**
 * Fetches messages from a channel, newest first, up to `maxMessages`.
 *
 * `conversations.history` returns only top-level messages; replies inside a
 * thread are served by `conversations.replies` and are therefore NOT indexed —
 * threaded discussion content is missing from the synced document.
 */
async function fetchChannelMessages(
  accessToken: string,
  channelId: string,
  maxMessages: number
): Promise<{ messages: SlackMessage[]; lastActivityTs?: string; oldestTs?: string }> {
  const allMessages: SlackMessage[] = []
  let cursor: string | undefined
  let lastActivityTs: string | undefined

  while (allMessages.length < maxMessages) {
    const limit = Math.min(MESSAGES_PER_PAGE, maxMessages - allMessages.length)
    const params: Record<string, string> = {
      channel: channelId,
      limit: String(limit),
    }
    if (cursor) {
      params.cursor = cursor
    }

    const data = await slackApiGet('conversations.history', accessToken, params)
    const messages = (data.messages as SlackMessage[]) || []

    if (messages.length === 0) break

    if (!lastActivityTs && messages.length > 0) {
      lastActivityTs = messages[0].ts
    }

    allMessages.push(...messages)

    const responseMeta = data.response_metadata as { next_cursor?: string } | undefined
    const nextCursor = responseMeta?.next_cursor
    if (!nextCursor) break
    cursor = nextCursor
  }

  const trimmed = allMessages.slice(0, maxMessages)
  const oldestTs = trimmed.length > 0 ? trimmed[trimmed.length - 1].ts : undefined
  return { messages: trimmed, lastActivityTs, oldestTs }
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
 * Converts fetched messages into a single document content string.
 * Each entry: "[ISO timestamp] username: message text" (text may span lines
 * when the message has rich attachment/block content).
 */
/**
 * Appends the messages to the transcript oldest first. The transcript keeps
 * its newest messages when the window does not fit, so a message is skipped
 * only when it cannot fit on its own.
 */
async function appendMessages(
  accessToken: string,
  lines: BoundedLines,
  messages: SlackMessage[],
  syncContext?: Record<string, unknown>
): Promise<void> {
  /** Slack returns newest first; the transcript reads oldest first. */
  const chronological = [...messages].reverse()

  for (const msg of chronological) {
    /**
     * Drop only known noise subtypes (channel join/leave/topic events,
     * bot add/remove, etc.). Per https://api.slack.com/events/message any
     * subtype with user-authored text — `thread_broadcast`, `me_message`,
     * `bot_message`, `file_share`, `reminder_add`, etc. — should be kept.
     */
    if (msg.subtype && SLACK_NOISE_SUBTYPES.has(msg.subtype)) continue

    const content = extractMessageContent(msg)
    if (!content) continue

    const timestamp = formatSlackTimestamp(msg.ts)
    const userName = msg.user
      ? await resolveUserName(accessToken, msg.user, syncContext)
      : msg.username || 'unknown'

    lines.push(`[${timestamp}] ${userName}: ${content}`)
  }
}

/**
 * Resolves a channel name or ID to a channel ID and metadata.
 */
async function resolveChannel(
  accessToken: string,
  channelInput: string
): Promise<SlackChannel | null> {
  const trimmed = channelInput.trim().replace(/^#/, '')

  // If it looks like a channel ID (public C / private G), try direct lookup.
  // DMs (D...) and MPIMs require im:*/mpim:* scopes, which we do not request.
  if (/^[CG][A-Z0-9]+$/.test(trimmed)) {
    try {
      const data = await slackApiGet('conversations.info', accessToken, { channel: trimmed })
      return data.channel as SlackChannel
    } catch (error) {
      /**
       * Only an unknown channel justifies the name-based fallback. Rethrowing
       * everything else (auth failures, `missing_scope`, exhausted rate-limit
       * retries) avoids walking the full `conversations.list` just to report a
       * misleading "Channel not found" for a channel that does exist.
       */
      if (!(error instanceof SlackApiError) || error.code !== 'channel_not_found') {
        throw error
      }
    }
  }

  // Search by name through conversations.list (include private channels the bot is in)
  let cursor: string | undefined
  do {
    const params: Record<string, string> = {
      types: 'public_channel,private_channel',
      limit: '200',
      exclude_archived: 'true',
    }
    if (cursor) {
      params.cursor = cursor
    }

    const data = await slackApiGet('conversations.list', accessToken, params)
    const channels = (data.channels as SlackChannel[]) || []

    const match = channels.find((ch) => ch.name === trimmed)
    if (match) return match

    const responseMeta = data.response_metadata as { next_cursor?: string } | undefined
    cursor = responseMeta?.next_cursor || undefined
  } while (cursor)

  return null
}

/**
 * Resolves the Slack team ID for the current token, caching the result on
 * `syncContext._slackTeamId` to avoid repeated `auth.test` calls. The team ID
 * is stable per token, so caching for the lifetime of a sync is safe.
 */
async function resolveTeamId(
  accessToken: string,
  syncContext?: Record<string, unknown>
): Promise<string | undefined> {
  const cacheKey = '_slackTeamId'
  if (syncContext && typeof syncContext[cacheKey] === 'string') {
    return syncContext[cacheKey] as string
  }

  try {
    const authData = await slackApiGet('auth.test', accessToken, {})
    const teamId = authData.team_id as string | undefined
    if (teamId && syncContext) {
      syncContext[cacheKey] = teamId
    }
    return teamId
  } catch (error) {
    logger.warn('Failed to resolve Slack team ID', {
      error: toError(error).message,
    })
    return undefined
  }
}

function channelUrl(channel: SlackChannel, teamId: string | undefined): string {
  return teamId
    ? `https://app.slack.com/client/${teamId}/${channel.id}`
    : `https://app.slack.com/client/${channel.id}`
}

/**
 * A token that is stable for one sync run and different on the next. A channel
 * listing carries no signal of new messages (`conversations.list` returns no
 * last-message timestamp, and reading one per channel would cost a Tier 3 call
 * per channel per listing), so every listed channel is hydrated each run and
 * the real hash `getDocument` computes decides whether anything is re-indexed:
 * an unchanged channel costs one history page and no embedding. The member
 * engine sets `syncRunId` on every member's context, so members listing the
 * same channel agree on its stub.
 */
function listingToken(syncContext?: Record<string, unknown>): string {
  const runId = syncContext?.syncRunId
  if (typeof runId === 'string' && runId) return runId
  const cached = syncContext?.[LISTING_TOKEN_KEY]
  if (typeof cached === 'string') return cached
  const token = generateId()
  if (syncContext) syncContext[LISTING_TOKEN_KEY] = token
  return token
}

/** The deferred listing stub for a channel; its transcript is fetched in `getDocument`. */
function channelToStub(
  channel: SlackChannel,
  teamId: string | undefined,
  syncContext?: Record<string, unknown>
): ExternalDocument {
  return {
    externalId: channel.id,
    title: `#${channel.name}`,
    content: '',
    contentDeferred: true,
    estimatedBytes: CONNECTOR_TEXT_DOCUMENT_MAX_BYTES,
    mimeType: 'text/plain',
    sourceUrl: channelUrl(channel, teamId),
    contentHash: `slack-listing:${channel.id}:${listingToken(syncContext)}`,
    metadata: {
      channelName: channel.name,
      topic: channel.topic?.value,
      purpose: channel.purpose?.value,
    },
  }
}

/** One page of every unarchived channel the token can read. */
async function listChannelsPage(
  accessToken: string,
  cursor: string | undefined
): Promise<{ channels: SlackChannel[]; nextCursor: string | undefined }> {
  const params: Record<string, string> = {
    types: LISTED_CHANNEL_TYPES,
    limit: String(CHANNELS_PER_PAGE),
    exclude_archived: 'true',
  }
  if (cursor) params.cursor = cursor
  const data = await slackApiGet('conversations.list', accessToken, params)
  const responseMeta = data.response_metadata as { next_cursor?: string } | undefined
  return {
    channels: (data.channels as SlackChannel[]) || [],
    nextCursor: responseMeta?.next_cursor || undefined,
  }
}

/**
 * Builds a channel's document: a header naming the channel, its topic and its
 * purpose, then the newest `maxMessages` messages oldest first. The header
 * means a channel with no messages in the window is still a live document, so
 * the sync engine never mistakes an empty channel for a deleted one.
 *
 * The `contentHash` is derived from stable Slack metadata — channel ID, the
 * newest message `ts`, and the message count — rather than the formatted text.
 * This keeps the hash deterministic across calls even though the formatted
 * content depends on the user-name cache state and the sliding message window.
 *
 * Each Slack message has a unique, stable `ts` per channel
 * (https://api.slack.com/methods/conversations.history), so `lastActivityTs`
 * uniquely identifies the newest message included in the document.
 */
async function buildSlackChannelDocument(
  accessToken: string,
  channel: SlackChannel,
  maxMessages: number,
  syncContext?: Record<string, unknown>
): Promise<{
  content: string
  contentHash: string
  messageCount: number
  lastActivityTs?: string
}> {
  const { messages, lastActivityTs, oldestTs } = await fetchChannelMessages(
    accessToken,
    channel.id,
    maxMessages
  )

  const header = [`Channel: #${channel.name}`]
  const topic = channel.topic?.value?.trim()
  if (topic) header.push(`Topic: ${topic}`)
  const purpose = channel.purpose?.value?.trim()
  if (purpose) header.push(`Purpose: ${purpose}`)

  /** The newest messages survive when the window does not fit; the header always does. */
  const lines = new BoundedLines(CONNECTOR_TEXT_DOCUMENT_MAX_BYTES, 'last')
  lines.pin(...header, '')
  await appendMessages(accessToken, lines, messages, syncContext)
  const messageCount = lines.count

  /**
   * Edit/thread fingerprint: max(edited.ts) and max(latest_reply) across the
   * window. `ts` is immutable for messages, so without these signals an
   * in-place edit (chat.update) or a new threaded reply would not change the
   * channel hash. Slack returns `edited.ts` only when a message was edited
   * and `latest_reply` only when threaded replies exist.
   */
  let maxEditTs = ''
  let maxReplyTs = ''
  let totalReplies = 0
  for (const m of messages) {
    if (m.edited?.ts && m.edited.ts > maxEditTs) maxEditTs = m.edited.ts
    if (m.latest_reply && m.latest_reply > maxReplyTs) maxReplyTs = m.latest_reply
    if (typeof m.reply_count === 'number') totalReplies += m.reply_count
  }

  /**
   * `latest_reply` alone misses reply edits and deletes. Folding `reply_count`
   * in catches deletes (count drops) but still cannot detect reply edits
   * without fetching `conversations.replies` for each parent.
   *
   * The header is digested into the hash because it is part of the document:
   * renaming a channel or editing its topic changes the indexed text without
   * touching a single message, and the sync engine drops a refresh whose hash
   * matches the stored one. A digest keeps the hash bounded and free of the
   * delimiter collisions raw topic text would bring.
   *
   * The `slack-v3` prefix forces a one-time re-index of channels indexed
   * before the document gained its header and size ceiling; `slack-v2` did the
   * same when attachment and Block Kit content started being extracted.
   * Per-message `ts` and the window are unchanged by either, so without the
   * bump the hash would match and the richer content would never be embedded.
   */
  const headerDigest = createHash('sha256').update(header.join('\n')).digest('hex').slice(0, 16)
  const contentHash = `slack-v3:${channel.id}:${headerDigest}:${oldestTs ?? 'empty'}:${lastActivityTs ?? 'empty'}:${messages.length}:${maxEditTs || 'noedit'}:${maxReplyTs || 'noreply'}:${totalReplies}`

  return { content: lines.join(), contentHash, messageCount, lastActivityTs }
}

export const slackConnector: ConnectorConfig = {
  ...slackConnectorMeta,

  /**
   * Lists the configured channels, or, when none are configured, every channel
   * the token can read. A members-mode crawl clears the channel selection, so
   * each member's listing is their whole view of the workspace. Listing stubs
   * are deferred: the transcript is fetched in `getDocument`, once per channel
   * per run, however many members list it.
   */
  listDocuments: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    cursor?: string,
    syncContext?: Record<string, unknown>
  ): Promise<ExternalDocumentList> => {
    const channelInputs = parseMultiValue(sourceConfig.channel)
    const teamId = await resolveTeamId(accessToken, syncContext)

    if (channelInputs.length === 0) {
      logger.info('Listing every readable Slack channel', { hasCursor: Boolean(cursor) })
      const page = await listChannelsPage(accessToken, cursor)
      return {
        documents: page.channels.map((channel) => channelToStub(channel, teamId, syncContext)),
        nextCursor: page.nextCursor,
        hasMore: page.nextCursor !== undefined,
      }
    }

    logger.info('Listing configured Slack channels', { channels: channelInputs })
    const documents: ExternalDocument[] = []
    for (const channelInput of channelInputs) {
      const channel = await resolveChannel(accessToken, channelInput)
      if (!channel) {
        /**
         * Fail loudly rather than silently skipping. A configured channel that
         * suddenly stops resolving (bot removed, channel archived, renamed)
         * would otherwise have its previously-indexed document orphaned and
         * deleted by the sync engine with no error surfaced. Matches the MS
         * Teams connector's behaviour.
         */
        throw new Error(`Channel not found: ${channelInput}`)
      }
      documents.push(channelToStub(channel, teamId, syncContext))
    }

    /**
     * Configured channels are listed in one call — the multi-select UI keeps
     * the count small, and each channel is an independent document with its
     * own `externalId` and `contentHash`.
     */
    return { documents, hasMore: false }
  },

  getDocument: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    externalId: string,
    syncContext?: Record<string, unknown>
  ): Promise<ExternalDocument | null> => {
    const maxMessages = resolveMaxMessages(sourceConfig.maxMessages)

    try {
      const data = await slackApiGet('conversations.info', accessToken, { channel: externalId })
      const channel = data.channel as SlackChannel

      const { content, contentHash, messageCount, lastActivityTs } =
        await buildSlackChannelDocument(accessToken, channel, maxMessages, syncContext)
      const teamId = await resolveTeamId(accessToken, syncContext)

      return {
        externalId: channel.id,
        title: `#${channel.name}`,
        content,
        mimeType: 'text/plain',
        sourceUrl: channelUrl(channel, teamId),
        contentHash,
        metadata: {
          channelName: channel.name,
          messageCount,
          lastActivity: lastActivityTs ? formatSlackTimestamp(lastActivityTs) : undefined,
          topic: channel.topic?.value,
          purpose: channel.purpose?.value,
        },
      }
    } catch (error) {
      /**
       * `null` means "gone" to the sync engine, so only a deleted channel maps
       * to it. Auth, scope and transport failures are rethrown so they surface
       * as a failed document rather than a silent drop.
       */
      if (error instanceof SlackApiError && error.code === 'channel_not_found') {
        return null
      }
      throw error
    }
  },

  validateConfig: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>
  ): Promise<{ valid: boolean; error?: string }> => {
    const channelInputs = parseMultiValue(sourceConfig.channel)
    const maxMessages = sourceConfig.maxMessages as string | undefined

    if (channelInputs.length === 0) {
      return { valid: false, error: 'At least one channel is required' }
    }

    if (maxMessages && (Number.isNaN(Number(maxMessages)) || Number(maxMessages) <= 0)) {
      return { valid: false, error: 'Max messages must be a positive number' }
    }

    try {
      /**
       * Validate every selected channel. ID-shaped inputs use `conversations.info`
       * directly; name-shaped inputs are resolved by paginating `conversations.list`
       * once and matching all remaining names against the same pages — this avoids
       * walking the full channel list once per name.
       */
      const nameLookups: string[] = []
      for (const input of channelInputs) {
        const trimmed = input.trim().replace(/^#/, '')

        if (/^[CG][A-Z0-9]+$/.test(trimmed)) {
          try {
            await slackApiGet(
              'conversations.info',
              accessToken,
              { channel: trimmed },
              VALIDATE_RETRY_OPTIONS
            )
          } catch (error) {
            /**
             * Only an unknown channel is reported as missing. A scope, auth or
             * transport failure falls through to the outer catch and keeps its
             * own message — otherwise the user re-picks a channel that exists
             * instead of reconnecting the credential.
             */
            if (error instanceof SlackApiError && error.code === 'channel_not_found') {
              return { valid: false, error: `Channel not found: ${input}` }
            }
            throw error
          }
        } else {
          nameLookups.push(trimmed)
        }
      }

      if (nameLookups.length === 0) {
        return { valid: true }
      }

      const remaining = new Set(nameLookups)
      let cursor: string | undefined
      do {
        const params: Record<string, string> = {
          types: 'public_channel,private_channel',
          limit: '200',
          exclude_archived: 'true',
        }
        if (cursor) {
          params.cursor = cursor
        }

        const data = await slackApiGet(
          'conversations.list',
          accessToken,
          params,
          VALIDATE_RETRY_OPTIONS
        )
        const channels = (data.channels as SlackChannel[]) || []

        for (const ch of channels) {
          if (remaining.has(ch.name)) {
            remaining.delete(ch.name)
          }
        }

        if (remaining.size === 0) return { valid: true }

        const responseMeta = data.response_metadata as { next_cursor?: string } | undefined
        cursor = responseMeta?.next_cursor || undefined
      } while (cursor)

      const missing = Array.from(remaining)
      return { valid: false, error: `Channel(s) not found: ${missing.join(', ')}` }
    } catch (error) {
      const message = toError(error).message || 'Failed to validate configuration'
      return { valid: false, error: message }
    }
  },

  mapTags: (metadata: Record<string, unknown>): Record<string, unknown> => {
    const result: Record<string, unknown> = {}

    if (typeof metadata.channelName === 'string') {
      result.channelName = metadata.channelName
    }

    if (typeof metadata.messageCount === 'number') {
      result.messageCount = metadata.messageCount
    }

    const lastActivity = parseTagDate(metadata.lastActivity)
    if (lastActivity) {
      result.lastActivity = lastActivity
    }

    return result
  },
}
