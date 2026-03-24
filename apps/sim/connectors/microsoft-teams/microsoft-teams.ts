import { createLogger } from '@sim/logger'
import { MicrosoftTeamsIcon } from '@/components/icons'
import { fetchWithRetry, VALIDATE_RETRY_OPTIONS } from '@/lib/knowledge/documents/utils'
import type { ConnectorConfig, ExternalDocument, ExternalDocumentList } from '@/connectors/types'
import { computeContentHash, htmlToPlainText, parseTagDate } from '@/connectors/utils'

const logger = createLogger('MicrosoftTeamsConnector')

const GRAPH_API_BASE = 'https://graph.microsoft.com/v1.0'
const DEFAULT_MAX_MESSAGES = 1000
const MESSAGES_PER_PAGE = 50

interface TeamsMessage {
  id: string
  messageType: string
  createdDateTime: string
  lastModifiedDateTime?: string
  deletedDateTime?: string | null
  from?: {
    user?: {
      id: string
      displayName: string
    }
    application?: {
      id: string
      displayName: string
    }
  }
  body: {
    contentType: string
    content: string
  }
  subject?: string | null
}

interface TeamsChannel {
  id: string
  displayName: string
  description?: string | null
}

interface TeamsMessagesResponse {
  '@odata.nextLink'?: string
  value: TeamsMessage[]
}

interface TeamsChannelsResponse {
  '@odata.nextLink'?: string
  value: TeamsChannel[]
}

/**
 * Calls the Microsoft Graph API with the given path and access token.
 */
async function graphApiGet<T>(
  path: string,
  accessToken: string,
  retryOptions?: Parameters<typeof fetchWithRetry>[2]
): Promise<T> {
  const url = path.startsWith('https://') ? path : `${GRAPH_API_BASE}${path}`

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
    const errorBody = await response.text().catch(() => '')
    throw new Error(`Microsoft Graph API error: ${response.status} ${errorBody}`)
  }

  return (await response.json()) as T
}

/**
 * Fetches all messages from a channel, up to a maximum count, handling pagination.
 */
async function fetchChannelMessages(
  accessToken: string,
  teamId: string,
  channelId: string,
  maxMessages: number
): Promise<{ messages: TeamsMessage[]; lastActivityTs?: string }> {
  const allMessages: TeamsMessage[] = []
  let nextLink: string | undefined
  let lastActivityTs: string | undefined

  const initialPath = `/teams/${encodeURIComponent(teamId)}/channels/${encodeURIComponent(channelId)}/messages?$top=${Math.min(MESSAGES_PER_PAGE, maxMessages)}`

  let currentUrl: string = initialPath

  while (allMessages.length < maxMessages) {
    const data = await graphApiGet<TeamsMessagesResponse>(currentUrl, accessToken)
    const messages = data.value || []

    if (messages.length === 0) break

    // Filter to actual user messages (skip system/event messages)
    const userMessages = messages.filter(
      (msg) => msg.messageType === 'message' && !msg.deletedDateTime
    )

    if (!lastActivityTs && userMessages.length > 0) {
      lastActivityTs = userMessages[0].createdDateTime
    }

    allMessages.push(...userMessages)

    nextLink = data['@odata.nextLink']
    if (!nextLink) break
    currentUrl = nextLink
  }

  return { messages: allMessages.slice(0, maxMessages), lastActivityTs }
}

/**
 * Converts fetched messages into a single document content string.
 * Each line: "[ISO timestamp] username: message text"
 */
function formatMessages(messages: TeamsMessage[]): string {
  const lines: string[] = []

  // Process in reverse so oldest messages come first
  const chronological = [...messages].reverse()

  for (const msg of chronological) {
    const bodyText =
      msg.body.contentType === 'html' ? htmlToPlainText(msg.body.content) : msg.body.content

    if (!bodyText.trim()) continue

    const timestamp = msg.createdDateTime
    const userName = msg.from?.user?.displayName || msg.from?.application?.displayName || 'unknown'

    lines.push(`[${timestamp}] ${userName}: ${bodyText}`)
  }

  return lines.join('\n')
}

/**
 * Resolves a channel name or ID to a channel object within the given team.
 */
async function resolveChannel(
  accessToken: string,
  teamId: string,
  channelInput: string
): Promise<TeamsChannel | null> {
  const trimmed = channelInput.trim()

  // Fetch all channels for the team
  let nextLink: string | undefined
  const initialPath = `/teams/${encodeURIComponent(teamId)}/channels`
  let currentUrl: string = initialPath

  do {
    const data = await graphApiGet<TeamsChannelsResponse>(currentUrl, accessToken)
    const channels = data.value || []

    // Try matching by ID first, then by display name (case-insensitive)
    const match = channels.find(
      (ch) => ch.id === trimmed || ch.displayName.toLowerCase() === trimmed.toLowerCase()
    )
    if (match) return match

    nextLink = data['@odata.nextLink']
    if (nextLink) {
      currentUrl = nextLink
    }
  } while (nextLink)

  return null
}

export const microsoftTeamsConnector: ConnectorConfig = {
  id: 'microsoft_teams',
  name: 'Microsoft Teams',
  description: 'Sync channel messages from Microsoft Teams into your knowledge base',
  version: '1.0.0',
  icon: MicrosoftTeamsIcon,

  auth: {
    mode: 'oauth',
    provider: 'microsoft-teams',
    requiredScopes: ['ChannelMessage.Read.All', 'Channel.ReadBasic.All'],
  },

  configFields: [
    {
      id: 'teamSelector',
      title: 'Team',
      type: 'selector',
      selectorKey: 'microsoft.teams',
      canonicalParamId: 'teamId',
      mode: 'basic',
      placeholder: 'Select a team',
      required: true,
    },
    {
      id: 'teamId',
      title: 'Team ID',
      type: 'short-input',
      canonicalParamId: 'teamId',
      mode: 'advanced',
      placeholder: 'e.g. fbe2bf47-16c8-47cf-b4a5-4b9b187c508b',
      required: true,
      description: 'The ID of the Microsoft Teams team',
    },
    {
      id: 'channelSelector',
      title: 'Channel',
      type: 'selector',
      selectorKey: 'microsoft.channels',
      canonicalParamId: 'channel',
      mode: 'basic',
      dependsOn: ['teamSelector'],
      placeholder: 'Select a channel',
      required: true,
    },
    {
      id: 'channel',
      title: 'Channel',
      type: 'short-input',
      canonicalParamId: 'channel',
      mode: 'advanced',
      placeholder: 'e.g. General or 19:abc123@thread.tacv2',
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
    _syncContext?: Record<string, unknown>
  ): Promise<ExternalDocumentList> => {
    const teamId = sourceConfig.teamId as string
    const channelInput = sourceConfig.channel as string
    if (!teamId?.trim()) {
      throw new Error('Team ID is required')
    }
    if (!channelInput?.trim()) {
      throw new Error('Channel is required')
    }

    const maxMessages = sourceConfig.maxMessages
      ? Number(sourceConfig.maxMessages)
      : DEFAULT_MAX_MESSAGES

    logger.info('Syncing Microsoft Teams channel', { teamId, channel: channelInput, maxMessages })

    const channel = await resolveChannel(accessToken, teamId, channelInput)
    if (!channel) {
      throw new Error(`Channel not found: ${channelInput}`)
    }

    const { messages, lastActivityTs } = await fetchChannelMessages(
      accessToken,
      teamId,
      channel.id,
      maxMessages
    )

    const content = formatMessages(messages)
    if (!content.trim()) {
      logger.info(`No messages found in channel: ${channel.displayName}`)
      return { documents: [], hasMore: false }
    }

    const contentHash = await computeContentHash(content)

    const sourceUrl = `https://teams.microsoft.com/l/channel/${encodeURIComponent(channel.id)}/${encodeURIComponent(channel.displayName)}?groupId=${encodeURIComponent(teamId)}`

    const document: ExternalDocument = {
      externalId: channel.id,
      title: channel.displayName,
      content,
      mimeType: 'text/plain',
      sourceUrl,
      contentHash,
      metadata: {
        channelName: channel.displayName,
        messageCount: messages.length,
        lastActivity: lastActivityTs || undefined,
        description: channel.description || undefined,
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
    externalId: string
  ): Promise<ExternalDocument | null> => {
    const teamId = sourceConfig.teamId as string
    if (!teamId?.trim()) {
      return null
    }

    const maxMessages = sourceConfig.maxMessages
      ? Number(sourceConfig.maxMessages)
      : DEFAULT_MAX_MESSAGES

    try {
      // Fetch channel info
      const channelPath = `/teams/${encodeURIComponent(teamId)}/channels/${encodeURIComponent(externalId)}`
      const channel = await graphApiGet<TeamsChannel>(channelPath, accessToken)

      const { messages, lastActivityTs } = await fetchChannelMessages(
        accessToken,
        teamId,
        externalId,
        maxMessages
      )

      const content = formatMessages(messages)
      if (!content.trim()) return null

      const contentHash = await computeContentHash(content)

      const sourceUrl = `https://teams.microsoft.com/l/channel/${encodeURIComponent(channel.id)}/${encodeURIComponent(channel.displayName)}?groupId=${encodeURIComponent(teamId)}`

      return {
        externalId: channel.id,
        title: channel.displayName,
        content,
        mimeType: 'text/plain',
        sourceUrl,
        contentHash,
        metadata: {
          channelName: channel.displayName,
          messageCount: messages.length,
          lastActivity: lastActivityTs || undefined,
          description: channel.description || undefined,
        },
      }
    } catch (error) {
      logger.warn('Failed to get Microsoft Teams channel document', {
        externalId,
        error: error instanceof Error ? error.message : String(error),
      })
      return null
    }
  },

  validateConfig: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>
  ): Promise<{ valid: boolean; error?: string }> => {
    const teamId = sourceConfig.teamId as string | undefined
    const channelInput = sourceConfig.channel as string | undefined
    const maxMessages = sourceConfig.maxMessages as string | undefined

    if (!teamId?.trim()) {
      return { valid: false, error: 'Team ID is required' }
    }

    if (!channelInput?.trim()) {
      return { valid: false, error: 'Channel is required' }
    }

    if (maxMessages && (Number.isNaN(Number(maxMessages)) || Number(maxMessages) <= 0)) {
      return { valid: false, error: 'Max messages must be a positive number' }
    }

    try {
      const channel = await resolveChannel(accessToken, teamId, channelInput.trim())
      if (!channel) {
        return { valid: false, error: `Channel not found: ${channelInput}` }
      }

      // Verify we can read messages by fetching a single message
      const messagesPath = `/teams/${encodeURIComponent(teamId)}/channels/${encodeURIComponent(channel.id)}/messages?$top=1`
      await graphApiGet<TeamsMessagesResponse>(messagesPath, accessToken, VALIDATE_RETRY_OPTIONS)

      return { valid: true }
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
