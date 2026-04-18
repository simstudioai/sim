import { createLogger } from '@sim/logger'
import { DiscordIcon } from '@/components/icons'
import { toError } from '@/lib/core/utils/helpers'
import { fetchWithRetry, VALIDATE_RETRY_OPTIONS } from '@/lib/knowledge/documents/utils'
import type { ConnectorConfig, ExternalDocument, ExternalDocumentList } from '@/connectors/types'
import { computeContentHash, parseTagDate } from '@/connectors/utils'

const logger = createLogger('DiscordConnector')

const DISCORD_API_BASE = 'https://discord.com/api/v10'
const DEFAULT_MAX_MESSAGES = 1000
const MESSAGES_PER_PAGE = 100

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
    throw new Error(`Discord API error ${response.status}: ${body}`)
  }

  return response.json()
}

/**
 * Fetches all messages from a channel, up to a maximum count, using `before`-based pagination.
 * Discord returns messages newest-first; we collect them all then reverse for chronological order.
 */
async function fetchChannelMessages(
  botToken: string,
  channelId: string,
  maxMessages: number
): Promise<{ messages: DiscordMessage[]; lastActivityTs?: string }> {
  const allMessages: DiscordMessage[] = []
  let beforeId: string | undefined
  let lastActivityTs: string | undefined

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

    if (!messages || messages.length === 0) break

    if (!lastActivityTs && messages.length > 0) {
      lastActivityTs = messages[0].timestamp
    }

    allMessages.push(...messages)

    // The last message in the batch is the oldest; use its ID for the next page
    beforeId = messages[messages.length - 1].id

    // If we got fewer than requested, there are no more messages
    if (messages.length < limit) break
  }

  return { messages: allMessages.slice(0, maxMessages), lastActivityTs }
}

/**
 * Converts fetched messages into a single document content string.
 * Each line: "[ISO timestamp] username: message content"
 * Messages are returned chronologically (oldest first).
 */
function formatMessages(messages: DiscordMessage[]): string {
  const lines: string[] = []

  // Discord returns newest first; reverse for chronological order
  const chronological = [...messages].reverse()

  for (const msg of chronological) {
    // Skip system messages (type 0 = DEFAULT, type 19 = REPLY are user messages)
    if (msg.type !== 0 && msg.type !== 19) continue
    if (!msg.content) continue

    const userName = msg.author.username
    lines.push(`[${msg.timestamp}] ${userName}: ${msg.content}`)
  }

  return lines.join('\n')
}

export const discordConnector: ConnectorConfig = {
  id: 'discord',
  name: 'Discord',
  description: 'Sync channel messages from Discord into your knowledge base',
  version: '1.0.0',
  icon: DiscordIcon,

  auth: {
    mode: 'apiKey',
    label: 'Bot Token',
    placeholder: 'Enter your Discord bot token',
  },

  configFields: [
    {
      id: 'channelId',
      title: 'Channel ID',
      type: 'short-input',
      placeholder: 'e.g. 123456789012345678',
      required: true,
      description: 'The Discord channel ID to sync messages from',
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
    _syncContext?: Record<string, unknown>
  ): Promise<ExternalDocumentList> => {
    const channelId = sourceConfig.channelId as string
    if (!channelId?.trim()) {
      throw new Error('Channel ID is required')
    }

    const maxMessages = sourceConfig.maxMessages
      ? Number(sourceConfig.maxMessages)
      : DEFAULT_MAX_MESSAGES

    logger.info('Syncing Discord channel', { channelId, maxMessages })

    const channel = (await discordApiGet(
      `/channels/${channelId.trim()}`,
      accessToken
    )) as DiscordChannel

    const { messages, lastActivityTs } = await fetchChannelMessages(
      accessToken,
      channel.id,
      maxMessages
    )

    const content = formatMessages(messages)
    if (!content.trim()) {
      logger.info('No messages found in Discord channel', { channelId: channel.id })
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
    const maxMessages = sourceConfig.maxMessages
      ? Number(sourceConfig.maxMessages)
      : DEFAULT_MAX_MESSAGES

    try {
      const channel = (await discordApiGet(
        `/channels/${externalId}`,
        accessToken
      )) as DiscordChannel

      const { messages, lastActivityTs } = await fetchChannelMessages(
        accessToken,
        externalId,
        maxMessages
      )

      const content = formatMessages(messages)
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
      logger.warn('Failed to get Discord channel document', {
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
    const channelId = sourceConfig.channelId as string | undefined
    const maxMessages = sourceConfig.maxMessages as string | undefined

    if (!channelId?.trim()) {
      return { valid: false, error: 'Channel ID is required' }
    }

    if (maxMessages && (Number.isNaN(Number(maxMessages)) || Number(maxMessages) <= 0)) {
      return { valid: false, error: 'Max messages must be a positive number' }
    }

    try {
      await discordApiGet(
        `/channels/${channelId.trim()}`,
        accessToken,
        undefined,
        VALIDATE_RETRY_OPTIONS
      )
      return { valid: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to validate configuration'
      if (message.includes('401') || message.includes('403')) {
        return { valid: false, error: 'Invalid bot token or missing permissions for this channel' }
      }
      if (message.includes('404')) {
        return { valid: false, error: `Channel not found: ${channelId}` }
      }
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
