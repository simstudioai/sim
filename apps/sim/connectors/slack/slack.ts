import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { SlackIcon } from '@/components/icons'
import { fetchWithRetry, VALIDATE_RETRY_OPTIONS } from '@/lib/knowledge/documents/utils'
import type { ConnectorConfig, ExternalDocument, ExternalDocumentList } from '@/connectors/types'
import { parseMultiValue, parseTagDate } from '@/connectors/utils'

const logger = createLogger('SlackConnector')

const SLACK_API_BASE = 'https://slack.com/api'
const DEFAULT_MAX_MESSAGES = 1000
const MESSAGES_PER_PAGE = 200

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
    const error = (data.error as string) || 'unknown_error'
    throw new Error(`Slack API error: ${error}`)
  }

  return data
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
 * Fetches all messages from a channel, up to a maximum count, handling pagination.
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
async function formatMessages(
  accessToken: string,
  messages: SlackMessage[],
  syncContext?: Record<string, unknown>
): Promise<string> {
  const lines: string[] = []

  // Process in reverse so oldest messages come first
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

  return lines.join('\n')
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
    } catch {
      // Fall through to name-based search
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

/**
 * Builds a channel document payload shared by `listDocuments` and `getDocument`.
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

  const content = await formatMessages(accessToken, messages, syncContext)
  const messageCount = messages.length

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
   */
  /**
   * `slack-v2` prefix forces a one-time re-sync for channels indexed before
   * we started extracting attachment + Block Kit content from bot messages.
   * Per-message `ts` and `messageCount` are unchanged, so without the version
   * bump the hash would match and richer content would not be re-embedded.
   */
  const contentHash = `slack-v2:${channel.id}:${oldestTs ?? 'empty'}:${lastActivityTs ?? 'empty'}:${messageCount}:${maxEditTs || 'noedit'}:${maxReplyTs || 'noreply'}:${totalReplies}`

  return { content, contentHash, messageCount, lastActivityTs }
}

export const slackConnector: ConnectorConfig = {
  id: 'slack',
  name: 'Slack',
  description: 'Sync channel messages from Slack',
  version: '1.0.0',
  icon: SlackIcon,

  auth: {
    mode: 'oauth',
    provider: 'slack',
    requiredScopes: [
      'channels:read',
      'channels:history',
      'groups:read',
      'groups:history',
      'users:read',
    ],
  },

  configFields: [
    {
      id: 'channelSelector',
      title: 'Channels',
      type: 'selector',
      selectorKey: 'slack.channels',
      canonicalParamId: 'channel',
      mode: 'basic',
      multi: true,
      placeholder: 'Select one or more channels',
      required: true,
      description: 'Channels to sync messages from',
    },
    {
      id: 'channel',
      title: 'Channels',
      type: 'short-input',
      canonicalParamId: 'channel',
      mode: 'advanced',
      multi: true,
      placeholder: 'e.g. general, C01ABC23DEF (comma-separated for multiple)',
      required: true,
      description: 'Channel names or IDs to sync messages from',
    },
    {
      id: 'maxMessages',
      title: 'Max Messages',
      type: 'short-input',
      required: false,
      placeholder: `e.g. 500 (default: ${DEFAULT_MAX_MESSAGES})`,
    },
  ],

  listDocuments: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    _cursor?: string,
    syncContext?: Record<string, unknown>
  ): Promise<ExternalDocumentList> => {
    const channelInputs = parseMultiValue(sourceConfig.channel)
    if (channelInputs.length === 0) {
      throw new Error('At least one channel is required')
    }

    const maxMessages = sourceConfig.maxMessages
      ? Number(sourceConfig.maxMessages)
      : DEFAULT_MAX_MESSAGES

    logger.info('Syncing Slack channels', { channels: channelInputs, maxMessages })

    const teamId = await resolveTeamId(accessToken, syncContext)
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

      const { content, contentHash, messageCount, lastActivityTs } =
        await buildSlackChannelDocument(accessToken, channel, maxMessages, syncContext)
      if (!content.trim()) {
        logger.info(`No messages found in channel: #${channel.name}`)
        continue
      }

      const sourceUrl = teamId
        ? `https://app.slack.com/client/${teamId}/${channel.id}`
        : `https://app.slack.com/client/${channel.id}`

      documents.push({
        externalId: channel.id,
        title: `#${channel.name}`,
        content,
        mimeType: 'text/plain',
        sourceUrl,
        contentHash,
        metadata: {
          channelName: channel.name,
          messageCount,
          lastActivity: lastActivityTs ? formatSlackTimestamp(lastActivityTs) : undefined,
          topic: channel.topic?.value,
          purpose: channel.purpose?.value,
        },
      })
    }

    /**
     * All channels are processed in one call — the multi-select UI keeps the
     * count small, and each channel is an independent document with its own
     * `externalId` and `contentHash`, so the sync engine treats them as
     * independent documents.
     */
    return {
      documents,
      hasMore: false,
    }
  },

  getDocument: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    externalId: string,
    syncContext?: Record<string, unknown>
  ): Promise<ExternalDocument | null> => {
    const maxMessages = sourceConfig.maxMessages
      ? Number(sourceConfig.maxMessages)
      : DEFAULT_MAX_MESSAGES

    try {
      const data = await slackApiGet('conversations.info', accessToken, { channel: externalId })
      const channel = data.channel as SlackChannel

      const { content, contentHash, messageCount, lastActivityTs } =
        await buildSlackChannelDocument(accessToken, channel, maxMessages, syncContext)
      if (!content.trim()) return null

      const teamId = await resolveTeamId(accessToken, syncContext)
      const sourceUrl = teamId
        ? `https://app.slack.com/client/${teamId}/${channel.id}`
        : `https://app.slack.com/client/${channel.id}`

      return {
        externalId: channel.id,
        title: `#${channel.name}`,
        content,
        mimeType: 'text/plain',
        sourceUrl,
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
      logger.warn('Failed to get Slack channel document', {
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
          } catch {
            return { valid: false, error: `Channel not found: ${input}` }
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

  tagDefinitions: [
    { id: 'channelName', displayName: 'Channel Name', fieldType: 'text' },
    { id: 'messageCount', displayName: 'Message Count', fieldType: 'number' },
    { id: 'lastActivity', displayName: 'Last Activity', fieldType: 'date' },
  ],

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
