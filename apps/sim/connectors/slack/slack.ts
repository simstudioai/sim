import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { SlackIcon } from '@/components/icons'
import { fetchWithRetry, VALIDATE_RETRY_OPTIONS } from '@/lib/knowledge/documents/utils'
import type { ConnectorConfig, ExternalDocument, ExternalDocumentList } from '@/connectors/types'
import { computeContentHash, parseTagDate } from '@/connectors/utils'

const logger = createLogger('SlackConnector')

const SLACK_API_BASE = 'https://slack.com/api'
const DEFAULT_MAX_MESSAGES = 1000
const MESSAGES_PER_PAGE = 200

interface SlackMessage {
  type: string
  user?: string
  text?: string
  ts: string
  subtype?: string
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
): Promise<{ messages: SlackMessage[]; lastActivityTs?: string }> {
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

  return { messages: allMessages.slice(0, maxMessages), lastActivityTs }
}

/**
 * Converts fetched messages into a single document content string.
 * Each line: "[ISO timestamp] username: message text"
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
    // Skip non-user messages (join/leave, bot messages without text, etc.)
    if (!msg.text) continue
    if (msg.subtype && msg.subtype !== 'bot_message' && msg.subtype !== 'file_share') continue

    const timestamp = formatSlackTimestamp(msg.ts)
    const userName = msg.user
      ? await resolveUserName(accessToken, msg.user, syncContext)
      : 'unknown'

    lines.push(`[${timestamp}] ${userName}: ${msg.text}`)
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

  // If it looks like a channel ID (starts with C, D, or G), try direct lookup
  if (/^[CDG][A-Z0-9]+$/.test(trimmed)) {
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

export const slackConnector: ConnectorConfig = {
  id: 'slack',
  name: 'Slack',
  description: 'Sync channel messages from Slack into your knowledge base',
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
      title: 'Channel',
      type: 'selector',
      selectorKey: 'slack.channels',
      canonicalParamId: 'channel',
      mode: 'basic',
      placeholder: 'Select a channel',
      required: true,
      description: 'Channel to sync messages from',
    },
    {
      id: 'channel',
      title: 'Channel',
      type: 'short-input',
      canonicalParamId: 'channel',
      mode: 'advanced',
      placeholder: 'e.g. general or C01ABC23DEF',
      required: true,
      description: 'Channel name or ID to sync messages from',
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
    const channelInput = sourceConfig.channel as string
    if (!channelInput?.trim()) {
      throw new Error('Channel is required')
    }

    const maxMessages = sourceConfig.maxMessages
      ? Number(sourceConfig.maxMessages)
      : DEFAULT_MAX_MESSAGES

    logger.info('Syncing Slack channel', { channel: channelInput, maxMessages })

    const channel = await resolveChannel(accessToken, channelInput)
    if (!channel) {
      throw new Error(`Channel not found: ${channelInput}`)
    }

    const { messages, lastActivityTs } = await fetchChannelMessages(
      accessToken,
      channel.id,
      maxMessages
    )

    const content = await formatMessages(accessToken, messages, syncContext)
    if (!content.trim()) {
      logger.info(`No messages found in channel: #${channel.name}`)
      return { documents: [], hasMore: false }
    }

    const contentHash = await computeContentHash(content)

    // Attempt to get team ID for the source URL
    let sourceUrl = `https://app.slack.com/client/${channel.id}`
    try {
      const authData = await slackApiGet('auth.test', accessToken, {})
      const teamId = authData.team_id as string | undefined
      if (teamId) {
        sourceUrl = `https://app.slack.com/client/${teamId}/${channel.id}`
      }
    } catch {
      // Fall back to URL without team ID
    }

    const document: ExternalDocument = {
      externalId: channel.id,
      title: `#${channel.name}`,
      content,
      mimeType: 'text/plain',
      sourceUrl,
      contentHash,
      metadata: {
        channelName: channel.name,
        messageCount: messages.length,
        lastActivity: lastActivityTs ? formatSlackTimestamp(lastActivityTs) : undefined,
        topic: channel.topic?.value,
        purpose: channel.purpose?.value,
      },
    }

    // Each channel is one document; no pagination needed
    return {
      documents: [document],
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

      const { messages, lastActivityTs } = await fetchChannelMessages(
        accessToken,
        externalId,
        maxMessages
      )

      const content = await formatMessages(accessToken, messages, syncContext)
      if (!content.trim()) return null

      const contentHash = await computeContentHash(content)

      let sourceUrl = `https://app.slack.com/client/${channel.id}`
      try {
        const authData = await slackApiGet('auth.test', accessToken, {})
        const teamId = authData.team_id as string | undefined
        if (teamId) {
          sourceUrl = `https://app.slack.com/client/${teamId}/${channel.id}`
        }
      } catch {
        // Fall back to URL without team ID
      }

      return {
        externalId: channel.id,
        title: `#${channel.name}`,
        content,
        mimeType: 'text/plain',
        sourceUrl,
        contentHash,
        metadata: {
          channelName: channel.name,
          messageCount: messages.length,
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
    const channelInput = sourceConfig.channel as string | undefined
    const maxMessages = sourceConfig.maxMessages as string | undefined

    if (!channelInput?.trim()) {
      return { valid: false, error: 'Channel is required' }
    }

    if (maxMessages && (Number.isNaN(Number(maxMessages)) || Number(maxMessages) <= 0)) {
      return { valid: false, error: 'Max messages must be a positive number' }
    }

    try {
      const trimmed = channelInput.trim().replace(/^#/, '')

      // If it looks like a channel ID, verify directly
      if (/^[CDG][A-Z0-9]+$/.test(trimmed)) {
        await slackApiGet(
          'conversations.info',
          accessToken,
          { channel: trimmed },
          VALIDATE_RETRY_OPTIONS
        )
        return { valid: true }
      }

      // Otherwise search by name (include private channels the bot is in)
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

        const match = channels.find((ch) => ch.name === trimmed)
        if (match) return { valid: true }

        const responseMeta = data.response_metadata as { next_cursor?: string } | undefined
        cursor = responseMeta?.next_cursor || undefined
      } while (cursor)

      return { valid: false, error: `Channel not found: ${channelInput}` }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to validate configuration'
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
