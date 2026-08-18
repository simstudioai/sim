import { createLogger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import { fetchWithRetry, VALIDATE_RETRY_OPTIONS } from '@/lib/knowledge/documents/utils'
import { DEFAULT_MAX_MESSAGES, discordConnectorMeta } from '@/connectors/discord/meta'
import type { ConnectorConfig, ExternalDocument, ExternalDocumentList } from '@/connectors/types'
import { computeContentHash, parseTagDate } from '@/connectors/utils'

const logger = createLogger('DiscordConnector')

const DISCORD_API_BASE = 'https://discord.com/api/v10'
/** Discord caps `GET /channels/{id}/messages` at `limit=100`. */
const MESSAGES_PER_PAGE = 100
/** Upper bound on `maxMessages` so a mistyped value cannot page the API forever. */
const MAX_MESSAGES_CEILING = 50_000
/** Discord snowflakes are numeric strings; reject anything else before path interpolation. */
const SNOWFLAKE_PATTERN = /^\d{15,25}$/

/**
 * Message types whose `content` is user-authored prose worth indexing.
 * `0` = DEFAULT, `19` = REPLY.
 */
const INDEXABLE_MESSAGE_TYPES = new Set([0, 19])

/**
 * Normalizes the optional `maxMessages` config value to a positive integer,
 * falling back to the default for missing, non-numeric, or out-of-range input.
 */
function resolveMaxMessages(raw: unknown): number {
  if (raw === undefined || raw === null || raw === '') return DEFAULT_MAX_MESSAGES
  const parsed = Math.floor(Number(raw))
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_MAX_MESSAGES
  return Math.min(parsed, MAX_MESSAGES_CEILING)
}

interface DiscordMessage {
  id: string
  channel_id: string
  author: {
    id: string
    username: string
    discriminator?: string
    bot?: boolean
  }
  content: string
  timestamp: string
  edited_timestamp?: string | null
  type: number
}

interface DiscordChannel {
  id: string
  name?: string
  topic?: string | null
  guild_id?: string
  type: number
}

/**
 * Trims a user-supplied channel ID and returns it only if it is a Discord
 * snowflake, so nothing else can be interpolated into an API path.
 */
function normalizeChannelId(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  return SNOWFLAKE_PATTERN.test(trimmed) ? trimmed : null
}

/**
 * Carries the HTTP status so callers can tell a deleted channel (404 Unknown Channel)
 * from a transient fault (429, 5xx) that must not be swallowed.
 */
class DiscordApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
    this.name = 'DiscordApiError'
  }
}

/**
 * Calls the Discord REST API with Bot token auth.
 * Unlike Slack, Discord returns proper HTTP status codes for errors.
 */
async function discordApiGet(
  path: string,
  botToken: string,
  params?: Record<string, string>,
  retryOptions?: Parameters<typeof fetchWithRetry>[2]
): Promise<unknown> {
  const queryParams = params ? `?${new URLSearchParams(params).toString()}` : ''
  const url = `${DISCORD_API_BASE}${path}${queryParams}`

  const response = await fetchWithRetry(
    url,
    {
      method: 'GET',
      headers: {
        Authorization: `Bot ${botToken}`,
        Accept: 'application/json',
      },
    },
    retryOptions
  )

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new DiscordApiError(`Discord API error ${response.status}: ${body}`, response.status)
  }

  return response.json()
}

/**
 * Fetches all messages from a channel, up to a maximum count, using `before`-based
 * snowflake pagination (Discord exposes no cursor and no total count).
 * Discord returns messages newest-first; we collect them all then reverse for chronological order.
 *
 * `truncated` is true when the `maxMessages` cap — rather than a short page — ended
 * paging, so callers can log that older history may not be indexed. Discord reports no
 * total count, so a channel holding exactly `maxMessages` messages also reports true.
 */
async function fetchChannelMessages(
  botToken: string,
  channelId: string,
  maxMessages: number
): Promise<{ messages: DiscordMessage[]; lastActivityTs?: string; truncated: boolean }> {
  const allMessages: DiscordMessage[] = []
  let beforeId: string | undefined
  let lastActivityTs: string | undefined
  let truncated = false

  while (allMessages.length < maxMessages) {
    const limit = Math.min(MESSAGES_PER_PAGE, maxMessages - allMessages.length)
    const params: Record<string, string> = { limit: String(limit) }
    if (beforeId) {
      params.before = beforeId
    }

    const messages = (await discordApiGet(
      `/channels/${channelId}/messages`,
      botToken,
      params
    )) as DiscordMessage[]

    if (!Array.isArray(messages) || messages.length === 0) break

    if (!lastActivityTs) {
      lastActivityTs = messages[0].timestamp
    }

    allMessages.push(...messages)

    // The last message in the batch is the oldest; use its ID for the next page
    beforeId = messages[messages.length - 1].id

    // A short page means the channel history is exhausted; a full page means more remains
    if (messages.length < limit) break
    if (allMessages.length >= maxMessages) truncated = true
  }

  return { messages: allMessages.slice(0, maxMessages), lastActivityTs, truncated }
}

/**
 * Converts fetched messages into a single document content string.
 * Each line: "[ISO timestamp] username: message content"
 * Messages are returned chronologically (oldest first).
 *
 * `contentStripped` is true when indexable messages existed but every one of
 * them had an empty `content`. Discord blanks `content` (along with `embeds`,
 * `attachments`, and `components`) for applications without the
 * `MESSAGE_CONTENT` privileged intent, so this shape almost always means the
 * intent is disabled rather than that the channel is genuinely empty.
 */
function formatMessages(messages: DiscordMessage[]): {
  content: string
  contentStripped: boolean
} {
  const lines: string[] = []
  let indexableCount = 0

  // Discord returns newest first; reverse for chronological order
  const chronological = [...messages].reverse()

  for (const msg of chronological) {
    if (!INDEXABLE_MESSAGE_TYPES.has(msg.type)) continue
    indexableCount++
    if (!msg.content) continue

    const userName = msg.author.username
    lines.push(`[${msg.timestamp}] ${userName}: ${msg.content}`)
  }

  return {
    content: lines.join('\n'),
    contentStripped: indexableCount > 0 && lines.length === 0,
  }
}

export const discordConnector: ConnectorConfig = {
  ...discordConnectorMeta,

  listDocuments: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    _cursor?: string,
    syncContext?: Record<string, unknown>
  ): Promise<ExternalDocumentList> => {
    const channelId = normalizeChannelId(sourceConfig.channelId)
    if (!channelId) {
      throw new Error('A valid numeric Discord channel ID is required')
    }

    const maxMessages = resolveMaxMessages(sourceConfig.maxMessages)

    logger.info('Syncing Discord channel', { channelId, maxMessages })

    const channel = (await discordApiGet(`/channels/${channelId}`, accessToken)) as DiscordChannel

    const { messages, lastActivityTs, truncated } = await fetchChannelMessages(
      accessToken,
      channelId,
      maxMessages
    )

    if (truncated) {
      logger.warn('Discord channel history truncated by maxMessages; older messages not indexed', {
        channelId,
        maxMessages,
      })
    }

    const { content, contentStripped } = formatMessages(messages)
    if (!content.trim()) {
      if (contentStripped) {
        /**
         * The channel still has messages, but Discord returned them with blank
         * `content` — the `MESSAGE_CONTENT` privileged intent is almost certainly
         * disabled for this bot. Emitting an empty listing here would let the sync
         * engine hard-delete the already-stored channel document (the connector owns
         * a single document, so it sits below the engine's suspect-empty-listing
         * threshold). Cap the listing so deletion reconciliation is skipped.
         */
        logger.warn(
          'Discord returned messages with empty content; enable the MESSAGE_CONTENT privileged intent for this bot',
          { channelId, messageCount: messages.length }
        )
        if (syncContext) syncContext.listingCapped = true
      } else {
        logger.info('No messages found in Discord channel', { channelId })
      }
      return { documents: [], hasMore: false }
    }

    const contentHash = await computeContentHash(content)
    const channelName = channel.name || channel.id
    const sourceUrl = `https://discord.com/channels/${channel.guild_id || '@me'}/${channel.id}`

    const document: ExternalDocument = {
      externalId: channel.id,
      title: `#${channelName}`,
      content,
      mimeType: 'text/plain',
      sourceUrl,
      contentHash,
      metadata: {
        channelName,
        messageCount: messages.length,
        lastActivity: lastActivityTs,
        topic: channel.topic ?? undefined,
      },
    }

    return {
      documents: [document],
      hasMore: false,
    }
  },

  getDocument: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    externalId: string
  ): Promise<ExternalDocument | null> => {
    const maxMessages = resolveMaxMessages(sourceConfig.maxMessages)

    const channelId = normalizeChannelId(externalId)
    if (!channelId) {
      logger.warn('Discord getDocument called with a non-snowflake external ID', { externalId })
      return null
    }

    try {
      const channel = (await discordApiGet(`/channels/${channelId}`, accessToken)) as DiscordChannel

      const { messages, lastActivityTs } = await fetchChannelMessages(
        accessToken,
        channelId,
        maxMessages
      )

      const { content } = formatMessages(messages)
      if (!content.trim()) return null

      const contentHash = await computeContentHash(content)
      const channelName = channel.name || channel.id
      const sourceUrl = `https://discord.com/channels/${channel.guild_id || '@me'}/${channel.id}`

      return {
        externalId: channel.id,
        title: `#${channelName}`,
        content,
        mimeType: 'text/plain',
        sourceUrl,
        contentHash,
        metadata: {
          channelName,
          messageCount: messages.length,
          lastActivity: lastActivityTs,
          topic: channel.topic ?? undefined,
        },
      }
    } catch (error) {
      /**
       * Only a 404 (Unknown Channel) means the channel is genuinely gone. Every other
       * failure — 429, 5xx, network faults — is rethrown so the sync engine records a
       * failed row instead of silently dropping a channel that still exists.
       */
      if (error instanceof DiscordApiError && error.status === 404) {
        logger.info('Discord channel not found', { externalId })
        return null
      }
      logger.warn('Failed to get Discord channel document', {
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
    const rawChannelId = sourceConfig.channelId
    const maxMessages = sourceConfig.maxMessages as string | undefined

    if (typeof rawChannelId !== 'string' || !rawChannelId.trim()) {
      return { valid: false, error: 'Channel ID is required' }
    }

    const channelId = normalizeChannelId(rawChannelId)
    if (!channelId) {
      return {
        valid: false,
        error: 'Channel ID must be a Discord snowflake (a numeric ID, e.g. 123456789012345678)',
      }
    }

    if (maxMessages && (Number.isNaN(Number(maxMessages)) || Number(maxMessages) <= 0)) {
      return { valid: false, error: 'Max messages must be a positive number' }
    }

    try {
      await discordApiGet(`/channels/${channelId}`, accessToken, undefined, VALIDATE_RETRY_OPTIONS)
      return { valid: true }
    } catch (error) {
      const message = getErrorMessage(error, 'Failed to validate configuration')
      if (message.includes('401') || message.includes('403')) {
        return {
          valid: false,
          error: 'Invalid bot token, or the bot lacks View Channel access to this channel',
        }
      }
      if (message.includes('404')) {
        return { valid: false, error: `Channel not found: ${channelId}` }
      }
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
