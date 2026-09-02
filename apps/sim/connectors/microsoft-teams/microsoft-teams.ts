import { createLogger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import { fetchWithRetry, VALIDATE_RETRY_OPTIONS } from '@/lib/knowledge/documents/utils'
import {
  DEFAULT_MAX_MESSAGES,
  microsoftTeamsConnectorMeta,
} from '@/connectors/microsoft-teams/meta'
import type { ConnectorConfig, ExternalDocument, ExternalDocumentList } from '@/connectors/types'
import {
  ConnectorListingScopeUnavailableError,
  computeContentHash,
  htmlToPlainText,
  isListingScopeUnavailableError,
  isPerMemberListing,
  parseMultiValue,
  parseTagDate,
} from '@/connectors/utils'

const logger = createLogger('MicrosoftTeamsConnector')

const GRAPH_API_ORIGIN = 'https://graph.microsoft.com'
const GRAPH_API_BASE = `${GRAPH_API_ORIGIN}/v1.0`

/**
 * Graph caps `$top` on channel messages at 50 per page (default 20).
 * https://learn.microsoft.com/graph/api/channel-list-messages
 */
const MESSAGES_PER_PAGE = 50

/**
 * Hard ceiling on `@odata.nextLink` hops drained per channel. Message paging is
 * driven entirely by server-issued skip tokens, so without a cap a channel that
 * keeps returning pages (e.g. one filled with system event messages that the
 * user-message filter discards) would loop indefinitely inside a single sync.
 */
const MAX_MESSAGE_PAGES = 200

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
  /** Populated by `$expand=replies`; absent on the reply objects themselves. */
  replies?: TeamsMessage[]
  /** Present when a message has more replies than the expand page size. */
  'replies@odata.nextLink'?: string
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
 * Resolves a relative Graph path or an absolute `@odata.nextLink` to a request
 * URL, refusing any absolute URL that does not point at Microsoft Graph. The
 * access token travels in the `Authorization` header, so following a
 * server-supplied link to another origin would hand that token to a third
 * party. Mirrors `assertGraphNextPageUrl` used by the Graph tool routes.
 */
function resolveGraphUrl(path: string): string {
  if (!path.startsWith('https://')) return `${GRAPH_API_BASE}${path}`

  const url = new URL(path.trim())
  if (url.origin !== GRAPH_API_ORIGIN) {
    throw new Error('Refusing to follow a non-Microsoft Graph @odata.nextLink')
  }
  return url.toString()
}

/** Carries the HTTP status so callers can tell a deleted channel from a fault. */
class GraphApiError extends Error {
  constructor(
    readonly status: number,
    body: string
  ) {
    super(`Microsoft Graph API error: ${status} ${body}`.trim())
    this.name = 'GraphApiError'
  }
}

/**
 * Calls the Microsoft Graph API with the given path and access token.
 */
async function graphApiGet<T>(
  path: string,
  accessToken: string,
  retryOptions?: Parameters<typeof fetchWithRetry>[2]
): Promise<T> {
  const url = resolveGraphUrl(path)

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
    throw new GraphApiError(response.status, errorBody)
  }

  return (await response.json()) as T
}

/**
 * Resolves the configured message budget, falling back to the default for
 * missing, non-numeric, or non-positive values.
 *
 * `validateConfig` rejects those inputs on save, but a config written before
 * validation tightened (or edited out-of-band) would otherwise yield `NaN`
 * here, which makes every budget comparison false and returns every channel
 * with zero messages — dropping it from the listing entirely.
 */
function resolveMaxMessages(value: unknown): number {
  if (value === undefined || value === null || value === '') return DEFAULT_MAX_MESSAGES
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : DEFAULT_MAX_MESSAGES
}

/** Real user/app posts, excluding system event messages and tombstones. */
function isUserMessage(message: TeamsMessage): boolean {
  return message.messageType === 'message' && !message.deletedDateTime
}

/** A root channel message together with the replies retained for it. */
interface TeamsThread {
  root: TeamsMessage
  replies: TeamsMessage[]
}

/**
 * Fetches conversation threads from a channel, newest first, up to a total
 * message budget shared by root messages and their replies.
 *
 * `GET /teams/{id}/channels/{id}/messages` returns root messages *without*
 * replies, so `$expand=replies` is required to capture threaded conversation
 * content. `$top` and `$expand` are the only OData parameters this endpoint
 * supports.
 */
async function fetchChannelMessages(
  accessToken: string,
  teamId: string,
  channelId: string,
  maxMessages: number
): Promise<{ threads: TeamsThread[]; messageCount: number; lastActivityTs?: string }> {
  const threads: TeamsThread[] = []
  let lastActivityTs: string | undefined
  let remaining = maxMessages
  let truncated = false
  let pages = 0

  let currentUrl = `/teams/${encodeURIComponent(teamId)}/channels/${encodeURIComponent(channelId)}/messages?$top=${Math.min(MESSAGES_PER_PAGE, maxMessages)}&$expand=replies`

  while (currentUrl && remaining > 0 && pages < MAX_MESSAGE_PAGES) {
    const data = await graphApiGet<TeamsMessagesResponse>(currentUrl, accessToken)
    pages += 1

    for (const message of data.value || []) {
      if (!isUserMessage(message)) continue
      if (remaining <= 0) {
        truncated = true
        break
      }

      /** Replies arrive newest-first, matching the root ordering. */
      const replies = (message.replies || []).filter(isUserMessage)
      if (message['replies@odata.nextLink']) truncated = true

      remaining -= 1
      const keptReplies = replies.slice(0, remaining)
      remaining -= keptReplies.length
      if (keptReplies.length < replies.length) truncated = true

      if (!lastActivityTs) {
        /**
         * Graph sorts channel messages by the last modified date of the entire
         * reply chain, so the first thread is the most recently active one —
         * but the freshest timestamp in it may belong to a reply, not the root.
         */
        const candidates = [message, ...replies].map(
          (m) => m.lastModifiedDateTime || m.createdDateTime
        )
        lastActivityTs = candidates.reduce((a, b) => (Date.parse(b) > Date.parse(a) ? b : a))
      }

      threads.push({ root: message, replies: keptReplies })
    }

    const nextLink = data['@odata.nextLink']
    currentUrl = nextLink ?? ''
    if (currentUrl && remaining <= 0) truncated = true
  }

  if (currentUrl && pages >= MAX_MESSAGE_PAGES) truncated = true

  if (truncated) {
    logger.warn('Microsoft Teams channel content truncated; indexed a partial message history', {
      teamId,
      channelId,
      maxMessages,
      pages,
      threads: threads.length,
    })
  }

  const messageCount = threads.reduce((total, thread) => total + 1 + thread.replies.length, 0)
  return { threads, messageCount, lastActivityTs }
}

/** Renders one message as "[ISO timestamp] username: text", or '' when blank. */
function formatMessage(message: TeamsMessage, prefix: string): string {
  const bodyText =
    message.body?.contentType === 'html'
      ? htmlToPlainText(message.body.content)
      : (message.body?.content ?? '')

  if (!bodyText.trim()) return ''

  const userName =
    message.from?.user?.displayName || message.from?.application?.displayName || 'unknown'

  return `${prefix}[${message.createdDateTime}] ${userName}: ${bodyText}`
}

/**
 * Converts fetched threads into a single document content string, oldest first,
 * with each thread's replies indented beneath its root message.
 */
function formatMessages(threads: TeamsThread[]): string {
  const lines: string[] = []

  // Process in reverse so oldest threads come first
  for (const thread of [...threads].reverse()) {
    const rootLine = formatMessage(thread.root, '')
    if (rootLine) lines.push(rootLine)

    for (const reply of [...thread.replies].reverse()) {
      const replyLine = formatMessage(reply, '    ')
      if (replyLine) lines.push(replyLine)
    }
  }

  return lines.join('\n')
}

/**
 * Resolves a channel name or ID to a channel object within the given team.
 */
async function resolveChannel(
  accessToken: string,
  teamId: string,
  channelInput: string,
  retryOptions?: Parameters<typeof fetchWithRetry>[2]
): Promise<TeamsChannel | null> {
  const trimmed = channelInput.trim()

  // Fetch all channels for the team
  let nextLink: string | undefined
  // $select avoids the expensive `email` property per Graph perf guidance.
  const initialPath = `/teams/${encodeURIComponent(teamId)}/channels?$select=id,displayName,description`
  let currentUrl: string = initialPath

  do {
    const data = await graphApiGet<TeamsChannelsResponse>(currentUrl, accessToken, retryOptions)
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

/**
 * Graph answers 403 for a team or private channel the caller is not a member
 * of and 404 for one it will not show them; a channel the caller's channel
 * list does not resolve is reported the same way.
 */
function isChannelScopeUnavailableError(error: unknown): boolean {
  return (
    isListingScopeUnavailableError(error) ||
    (error instanceof GraphApiError && (error.status === 403 || error.status === 404))
  )
}

/** Lists one configured channel as a document, or null when it holds no messages. */
async function listChannel(
  accessToken: string,
  teamId: string,
  channelInput: string,
  maxMessages: number
): Promise<ExternalDocument | null> {
  const channel = await resolveChannel(accessToken, teamId, channelInput)
  if (!channel) {
    throw new ConnectorListingScopeUnavailableError(`Channel not found: ${channelInput}`, 404)
  }

  const { threads, messageCount, lastActivityTs } = await fetchChannelMessages(
    accessToken,
    teamId,
    channel.id,
    maxMessages
  )

  const content = formatMessages(threads)
  if (!content.trim()) {
    logger.info(`No messages found in channel: ${channel.displayName}`)
    return null
  }

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
      messageCount,
      lastActivity: lastActivityTs || undefined,
      description: channel.description || undefined,
    },
  }
}

export const microsoftTeamsConnector: ConnectorConfig = {
  ...microsoftTeamsConnectorMeta,

  isListingScopeUnavailableError: isChannelScopeUnavailableError,

  listDocuments: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    _cursor?: string,
    syncContext?: Record<string, unknown>
  ): Promise<ExternalDocumentList> => {
    const teamId = sourceConfig.teamId as string
    const channelInputs = parseMultiValue(sourceConfig.channel)
    if (!teamId?.trim()) {
      throw new Error('Team ID is required')
    }
    if (channelInputs.length === 0) {
      throw new Error('At least one channel is required')
    }

    const maxMessages = resolveMaxMessages(sourceConfig.maxMessages)

    logger.info('Syncing Microsoft Teams channels', {
      teamId,
      channels: channelInputs,
      maxMessages,
    })

    const documents: ExternalDocument[] = []

    for (const channelInput of channelInputs) {
      let document: ExternalDocument | null
      try {
        document = await listChannel(accessToken, teamId, channelInput, maxMessages)
      } catch (error) {
        /**
         * One of several channels a member cannot reach is absent from their
         * listing, not the end of it: move on to the next channel so the rest
         * of their access survives. A sole unreachable channel is the whole
         * scope, which the members-mode crawl reads as a complete listing of
         * nothing, and a shared credential still fails the sync rather than
         * silently dropping the channel.
         */
        if (
          channelInputs.length > 1 &&
          isPerMemberListing(syncContext) &&
          isChannelScopeUnavailableError(error)
        ) {
          logger.warn('Skipping a Microsoft Teams channel the member cannot reach', {
            channel: channelInput,
            error: getErrorMessage(error),
          })
          continue
        }
        throw error
      }
      if (document) documents.push(document)
    }

    // All selected channels are emitted in a single page; no pagination needed
    return {
      documents,
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

    const maxMessages = resolveMaxMessages(sourceConfig.maxMessages)

    try {
      const channelPath = `/teams/${encodeURIComponent(teamId)}/channels/${encodeURIComponent(externalId)}?$select=id,displayName,description`
      const channel = await graphApiGet<TeamsChannel>(channelPath, accessToken)

      const { threads, messageCount, lastActivityTs } = await fetchChannelMessages(
        accessToken,
        teamId,
        externalId,
        maxMessages
      )

      const content = formatMessages(threads)
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
          messageCount,
          lastActivity: lastActivityTs || undefined,
          description: channel.description || undefined,
        },
      }
    } catch (error) {
      /**
       * Only a channel that is genuinely gone resolves to `null`. Every other
       * failure is rethrown so the sync engine records a visible failed document
       * instead of dropping the channel from the run with no counter and no log.
       */
      if (error instanceof GraphApiError && (error.status === 404 || error.status === 410)) {
        return null
      }
      logger.warn('Failed to get Microsoft Teams channel document', {
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
    const teamId = sourceConfig.teamId as string | undefined
    const channelInputs = parseMultiValue(sourceConfig.channel)
    const maxMessages = sourceConfig.maxMessages as string | undefined

    if (!teamId?.trim()) {
      return { valid: false, error: 'Team ID is required' }
    }

    if (channelInputs.length === 0) {
      return { valid: false, error: 'At least one channel is required' }
    }

    if (maxMessages && (Number.isNaN(Number(maxMessages)) || Number(maxMessages) <= 0)) {
      return { valid: false, error: 'Max messages must be a positive number' }
    }

    try {
      for (const channelInput of channelInputs) {
        const channel = await resolveChannel(
          accessToken,
          teamId,
          channelInput,
          VALIDATE_RETRY_OPTIONS
        )
        if (!channel) {
          return { valid: false, error: `Channel not found: ${channelInput}` }
        }

        // Verify we can read messages by fetching a single message
        const messagesPath = `/teams/${encodeURIComponent(teamId)}/channels/${encodeURIComponent(channel.id)}/messages?$top=1`
        await graphApiGet<TeamsMessagesResponse>(messagesPath, accessToken, VALIDATE_RETRY_OPTIONS)
      }

      return { valid: true }
    } catch (error) {
      const message = getErrorMessage(error, 'Failed to validate configuration')
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
