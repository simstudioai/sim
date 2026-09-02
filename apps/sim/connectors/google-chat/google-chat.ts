import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { fetchWithRetry, VALIDATE_RETRY_OPTIONS } from '@/lib/knowledge/documents/utils'
import {
  DEFAULT_MAX_MESSAGES,
  googleChatConnectorMeta,
  MESSAGES_PAGE_SIZE,
  SPACES_PAGE_SIZE,
} from '@/connectors/google-chat/meta'
import type { ConnectorConfig, ExternalDocument, ExternalDocumentList } from '@/connectors/types'
import { BoundedLines, CONNECTOR_TEXT_DOCUMENT_MAX_BYTES, parseTagDate } from '@/connectors/utils'

const logger = createLogger('GoogleChatConnector')

const CHAT_API_BASE = 'https://chat.googleapis.com/v1'
const MS_PER_DAY = 24 * 60 * 60 * 1000

/** `syncContext` key holding the spaces this run listed, keyed by resource name. */
const SPACE_CACHE_KEY = 'googleChatSpaces'

/** `syncContext` key holding this run's fallback activity token. */
const ACTIVITY_TOKEN_KEY = 'googleChatActivityToken'

/**
 * A Google Chat space as returned by `spaces.list` / `spaces.get`. Only the
 * fields this connector reads are modeled.
 *
 * https://developers.google.com/workspace/chat/api/reference/rest/v1/spaces
 */
interface Space {
  name: string
  displayName?: string
  spaceType?: 'SPACE_TYPE_UNSPECIFIED' | 'SPACE' | 'GROUP_CHAT' | 'DIRECT_MESSAGE'
  spaceUri?: string
  createTime?: string
  /** Output only. Timestamp of the last message in the space. */
  lastActiveTime?: string
  spaceDetails?: { description?: string; guidelines?: string }
}

interface SpacesListResponse {
  spaces?: Space[]
  nextPageToken?: string
}

/**
 * The author of a message.
 *
 * This connector authenticates as a user, and the User reference states that
 * "if your Chat app authenticates as a user, the output for a User resource
 * only populates the user's `name` and `type`" — so `displayName` is expected
 * to be absent here and `name` (a `users/{id}` resource name) is the label that
 * actually reaches the transcript. Resolving human names would need
 * `spaces.members.list` and the `chat.memberships.readonly` scope, which this
 * connector does not request. `displayName` is still read first so the
 * transcript improves for free if a call ever does carry it.
 *
 * https://developers.google.com/workspace/chat/api/reference/rest/v1/User
 */
interface ChatUser {
  name?: string
  displayName?: string
  type?: 'TYPE_UNSPECIFIED' | 'HUMAN' | 'BOT'
}

/**
 * A message in a space. `text` is the plain-text body; `fallbackText` is the
 * plain-text description of a card-only message.
 *
 * https://developers.google.com/workspace/chat/api/reference/rest/v1/spaces.messages
 */
interface ChatMessage {
  name: string
  sender?: ChatUser
  createTime?: string
  lastUpdateTime?: string
  text?: string
  fallbackText?: string
}

interface MessagesListResponse {
  messages?: ChatMessage[]
  nextPageToken?: string
}

function chatHeaders(accessToken: string): Record<string, string> {
  return { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' }
}

/** Trailing id segment of a `spaces/{space}` resource name. */
function resourceIdSegment(resourceName: string): string {
  return resourceName.slice(resourceName.lastIndexOf('/') + 1)
}

/** Normalizes a space identifier to its full resource name, tolerating a bare id. */
function spaceResourceName(externalId: string): string {
  const trimmed = externalId.trim()
  return trimmed.startsWith('spaces/') ? trimmed : `spaces/${trimmed}`
}

/**
 * Builds the `spaces.list` filter from the configured scope. The API only
 * supports filtering on `spaceType`, with `OR` between values; `ALL` omits the
 * filter entirely so every conversation type is listed.
 */
function buildSpacesFilter(sourceConfig: Record<string, unknown>): string | undefined {
  const scope = typeof sourceConfig.spaceTypes === 'string' ? sourceConfig.spaceTypes : 'SPACE'
  if (scope === 'ALL') return undefined
  if (scope === 'SPACE_AND_GROUP_CHAT') return 'spaceType = "SPACE" OR spaceType = "GROUP_CHAT"'
  return 'spaceType = "SPACE"'
}

/**
 * Resolves the per-space message window, falling back to the default for
 * missing, non-numeric, or non-positive values. `validateConfig` rejects those
 * inputs, but a config saved before validation existed would otherwise yield
 * `NaN` and index nothing.
 */
function resolveMaxMessages(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : DEFAULT_MAX_MESSAGES
}

/** Resolves the lookback window in days, or 0 when unset/invalid (no cutoff). */
function resolveLookbackDays(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0
}

/**
 * Human-readable title for a space. `displayName` is optional and documented as
 * possibly empty for direct messages, so the conversation type plus the space id
 * is used as a stable fallback rather than an anonymous "Untitled".
 */
function spaceTitle(space: Space): string {
  const displayName = space.displayName?.trim()
  if (displayName) return displayName
  const id = resourceIdSegment(space.name)
  if (space.spaceType === 'DIRECT_MESSAGE') return `Direct message ${id}`
  if (space.spaceType === 'GROUP_CHAT') return `Group chat ${id}`
  return `Google Chat space ${id}`
}

/**
 * Change-detection token for a space.
 *
 * `lastActiveTime` is documented as the timestamp of the last message in the
 * space, so it moves whenever new content arrives without any message having to
 * be fetched. The `spaces.list` reference documents `permissionSettings` as the
 * only field omitted from list responses, but it does not positively guarantee
 * `lastActiveTime` is populated for every space — and a space missing it would
 * hash to a constant, so its content would never be refreshed again.
 *
 * A space without the field therefore falls back to a token that is stable for
 * one sync run and different on the next, so the space re-hydrates every sync
 * rather than going silently stale. `listDocuments` warns when that branch is
 * taken, since it re-indexes the space's content on every sync.
 */
function activityToken(space: Space, syncContext?: Record<string, unknown>): string {
  const lastActiveTime = space.lastActiveTime?.trim()
  if (lastActiveTime) return lastActiveTime

  const cached = syncContext?.[ACTIVITY_TOKEN_KEY]
  if (typeof cached === 'string') return cached

  const token = `unknown-${generateId()}`
  if (syncContext) syncContext[ACTIVITY_TOKEN_KEY] = token
  return token
}

/**
 * Metadata-based change-detection hash. The window settings are folded in
 * because changing them changes which messages the document contains.
 *
 * Known limitation: editing or deleting an existing message does not advance
 * `lastActiveTime`, so such a change is only picked up once a newer message
 * lands or an explicit full resync runs — see `rehydrateOnFullSync` in `meta.ts`.
 */
function buildContentHash(
  space: Space,
  maxMessages: number,
  lookbackDays: number,
  syncContext?: Record<string, unknown>
): string {
  const token = activityToken(space, syncContext)
  return `gchat:v1:${space.name}:${token}:${maxMessages}:${lookbackDays}`
}

/** Records the spaces a listing page returned so `getDocument` can reuse them. */
function cacheSpaces(spaces: Space[], syncContext?: Record<string, unknown>): void {
  if (!syncContext) return
  const existing = syncContext[SPACE_CACHE_KEY]
  const cache = (existing && typeof existing === 'object' ? existing : {}) as Record<string, Space>
  for (const space of spaces) cache[space.name] = space
  syncContext[SPACE_CACHE_KEY] = cache
}

/** The listed space for a resource name, when this sync run listed it. */
function cachedSpace(name: string, syncContext?: Record<string, unknown>): Space | undefined {
  const cache = syncContext?.[SPACE_CACHE_KEY]
  if (!cache || typeof cache !== 'object') return undefined
  return (cache as Record<string, Space>)[name]
}

/**
 * Builds the deferred listing stub for a space. Messages are fetched lazily in
 * `getDocument`; only metadata and the change hash are computed here.
 */
function spaceToStub(
  space: Space,
  maxMessages: number,
  lookbackDays: number,
  syncContext?: Record<string, unknown>
): ExternalDocument {
  return {
    externalId: space.name,
    title: spaceTitle(space),
    content: '',
    contentDeferred: true,
    estimatedBytes: CONNECTOR_TEXT_DOCUMENT_MAX_BYTES,
    mimeType: 'text/plain',
    sourceUrl: space.spaceUri,
    contentHash: buildContentHash(space, maxMessages, lookbackDays, syncContext),
    metadata: {
      spaceName: spaceTitle(space),
      spaceType: space.spaceType,
      lastActivity: space.lastActiveTime,
    },
  }
}

/** Fetches a single space. Returns null on 404 (space deleted or left). */
async function fetchSpace(accessToken: string, name: string): Promise<Space | null> {
  const response = await fetchWithRetry(`${CHAT_API_BASE}/${name}`, {
    method: 'GET',
    headers: chatHeaders(accessToken),
  })
  if (!response.ok) {
    if (response.status === 404) return null
    throw new Error(`Failed to fetch Google Chat space: ${response.status}`)
  }
  return (await response.json()) as Space
}

/**
 * An RFC-3339 timestamp without fractional seconds, matching the form every
 * example in the `spaces.messages.list` filter reference uses. `toISOString()`
 * alone emits milliseconds, and the API rejects a filter it cannot parse with
 * `INVALID_ARGUMENT` rather than ignoring it.
 *
 * https://developers.google.com/workspace/chat/api/reference/rest/v1/spaces.messages/list
 */
function rfc3339(date: Date): string {
  return `${date.toISOString().slice(0, 19)}Z`
}

/**
 * Fetches the newest `maxMessages` messages of a space, optionally bounded by a
 * lookback window. Messages are requested newest-first so the cap keeps the most
 * recent conversation, then returned in chronological order.
 *
 * `orderBy` takes a full ordering expression, not a bare direction: the reference
 * documents the default as `createTime ASC` and lists ASC/DESC as the ordering
 * *operations* usable within one. `createTime` is the only orderable field here.
 */
async function fetchSpaceMessages(
  accessToken: string,
  spaceName: string,
  maxMessages: number,
  lookbackDays: number
): Promise<ChatMessage[]> {
  const filter =
    lookbackDays > 0
      ? `createTime > "${rfc3339(new Date(Date.now() - lookbackDays * MS_PER_DAY))}"`
      : undefined

  const collected: ChatMessage[] = []
  let pageToken: string | undefined

  while (collected.length < maxMessages) {
    const params = new URLSearchParams({
      pageSize: String(Math.min(MESSAGES_PAGE_SIZE, maxMessages - collected.length)),
      orderBy: 'createTime DESC',
    })
    if (filter) params.set('filter', filter)
    if (pageToken) params.set('pageToken', pageToken)

    const response = await fetchWithRetry(
      `${CHAT_API_BASE}/${spaceName}/messages?${params.toString()}`,
      { method: 'GET', headers: chatHeaders(accessToken) }
    )
    if (!response.ok) {
      if (response.status === 404) break
      throw new Error(`Failed to list Google Chat messages: ${response.status}`)
    }

    const data = (await response.json()) as MessagesListResponse
    const messages = data.messages ?? []
    if (messages.length === 0) break
    collected.push(...messages)

    pageToken = data.nextPageToken?.trim() || undefined
    if (!pageToken) break
  }

  return collected.slice(0, maxMessages).reverse()
}

/** Resolves a message author's label, preferring the display name. */
function senderLabel(sender: ChatUser | undefined): string {
  return sender?.displayName?.trim() || sender?.name?.trim() || 'Unknown'
}

/**
 * Renders a space's messages as one plain-text transcript. Card-only messages
 * fall back to `fallbackText`, the documented plain-text description of a
 * message's cards; messages with neither are skipped as they carry no text.
 *
 * Message attachments are deliberately not indexed. Downloading them needs the
 * separate `media.download` endpoint (and, for Drive-hosted attachments, Drive
 * scopes this connector does not request), which would turn one document per
 * space into an unbounded per-message download fan-out. A file shared in Chat
 * that belongs in a knowledge base is synced through the Google Drive connector
 * instead, which already handles size caps, OCR, and format parsing.
 */
function formatSpaceContent(space: Space, messages: ChatMessage[]): string {
  const parts = new BoundedLines()
  parts.push(`Space: ${spaceTitle(space)}`)
  const description = space.spaceDetails?.description?.trim()
  if (description) parts.push(`Description: ${description}`)
  const guidelines = space.spaceDetails?.guidelines?.trim()
  if (guidelines) parts.push(`Guidelines: ${guidelines}`)

  let headed = false
  for (const message of messages) {
    const text = message.text?.trim() || message.fallbackText?.trim()
    if (!text) continue
    if (!headed) {
      parts.push('', '--- Messages ---')
      headed = true
    }
    const timestamp = message.createTime ?? ''
    if (!parts.push(`[${timestamp}] ${senderLabel(message.sender)}: ${text}`)) break
  }

  return parts.join()
}

/** Number of messages that actually contributed text to the transcript. */
function countIndexedMessages(messages: ChatMessage[]): number {
  let count = 0
  for (const message of messages) {
    if (message.text?.trim() || message.fallbackText?.trim()) count++
  }
  return count
}

export const googleChatConnector: ConnectorConfig = {
  ...googleChatConnectorMeta,

  listDocuments: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    cursor?: string,
    syncContext?: Record<string, unknown>
  ): Promise<ExternalDocumentList> => {
    const maxSpaces = sourceConfig.maxSpaces ? Number(sourceConfig.maxSpaces) : 0
    const maxMessages = resolveMaxMessages(sourceConfig.maxMessages)
    const lookbackDays = resolveLookbackDays(sourceConfig.lookbackDays)
    const prevFetched = (syncContext?.totalDocsFetched as number) ?? 0

    const pageSize =
      maxSpaces > 0
        ? Math.min(SPACES_PAGE_SIZE, Math.max(1, maxSpaces - prevFetched))
        : SPACES_PAGE_SIZE
    const params = new URLSearchParams({ pageSize: String(pageSize) })
    if (cursor) params.set('pageToken', cursor)
    const filter = buildSpacesFilter(sourceConfig)
    if (filter) params.set('filter', filter)

    logger.info('Listing Google Chat spaces', {
      hasCursor: Boolean(cursor),
      hasFilter: Boolean(filter),
    })

    const response = await fetchWithRetry(`${CHAT_API_BASE}/spaces?${params.toString()}`, {
      method: 'GET',
      headers: chatHeaders(accessToken),
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => '')
      logger.error('Failed to list Google Chat spaces', {
        status: response.status,
        error: errorText.slice(0, 500),
      })
      throw new Error(`Failed to list Google Chat spaces: ${response.status}`)
    }

    const data = (await response.json()) as SpacesListResponse
    const spaces = (data.spaces ?? []).filter((space) => Boolean(space.name))
    const nextPageToken = data.nextPageToken?.trim() || undefined

    const missingActivity = spaces.filter((space) => !space.lastActiveTime?.trim()).length
    if (missingActivity > 0) {
      logger.warn(
        'Google Chat spaces listed without lastActiveTime; their content re-indexes every sync',
        { spacesMissingLastActiveTime: missingActivity, spacesInPage: spaces.length }
      )
    }

    cacheSpaces(spaces, syncContext)

    const allDocuments = spaces.map((space) =>
      spaceToStub(space, maxMessages, lookbackDays, syncContext)
    )

    let documents = allDocuments
    if (maxSpaces > 0) {
      const remaining = Math.max(0, maxSpaces - prevFetched)
      if (allDocuments.length > remaining) documents = allDocuments.slice(0, remaining)
    }

    const totalFetched = prevFetched + documents.length
    if (syncContext) syncContext.totalDocsFetched = totalFetched
    const reachedCap = maxSpaces > 0 && totalFetched >= maxSpaces

    /**
     * Only flag the listing as capped when the cap actually truncated a larger
     * source — either more pages remain, or spaces were dropped from this page.
     * A source that was fully listed and merely happens to equal the cap stays
     * unflagged so the sync engine still reconciles deletions.
     */
    const truncated =
      reachedCap && (Boolean(nextPageToken) || allDocuments.length > documents.length)
    if (truncated && syncContext) syncContext.listingCapped = true

    const hasMore = !reachedCap && Boolean(nextPageToken)

    return {
      documents,
      nextCursor: hasMore ? nextPageToken : undefined,
      hasMore,
    }
  },

  getDocument: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    externalId: string,
    syncContext?: Record<string, unknown>
  ): Promise<ExternalDocument | null> => {
    if (!externalId) return null
    const spaceName = spaceResourceName(externalId)

    /**
     * Reuses the space the listing already fetched. Beyond saving a `spaces.get`
     * per document, it is what keeps the hydrated `contentHash` identical to the
     * stub's: re-reading the space here could observe a `lastActiveTime` that
     * advanced after the listing, storing a hash for messages this call never
     * fetched and hiding them until the *next* message arrives.
     */
    const space = cachedSpace(spaceName, syncContext) ?? (await fetchSpace(accessToken, spaceName))
    if (!space) return null

    const maxMessages = resolveMaxMessages(sourceConfig.maxMessages)
    const lookbackDays = resolveLookbackDays(sourceConfig.lookbackDays)
    const messages = await fetchSpaceMessages(accessToken, spaceName, maxMessages, lookbackDays)

    /**
     * A space with no messages in the window is still a live space, so it is
     * indexed rather than skipped. `null` is this connector's "document is gone"
     * signal, and the engine treats it as last-known-good: returning it here would
     * both drop spaces whose only prose is their description or guidelines, and
     * leave a previously indexed transcript in place after the space was cleared
     * or `lookbackDays` was tightened past every message.
     */
    const messageCount = countIndexedMessages(messages)
    const stub = spaceToStub(space, maxMessages, lookbackDays, syncContext)

    return {
      ...stub,
      content: formatSpaceContent(space, messages),
      contentDeferred: false,
      metadata: { ...stub.metadata, messageCount },
    }
  },

  validateConfig: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>
  ): Promise<{ valid: boolean; error?: string }> => {
    const maxMessages = sourceConfig.maxMessages as string | undefined
    if (maxMessages && (Number.isNaN(Number(maxMessages)) || Number(maxMessages) <= 0)) {
      return { valid: false, error: 'Max messages per space must be a positive number' }
    }

    const maxSpaces = sourceConfig.maxSpaces as string | undefined
    if (maxSpaces && (Number.isNaN(Number(maxSpaces)) || Number(maxSpaces) <= 0)) {
      return { valid: false, error: 'Max spaces must be a positive number' }
    }

    const lookbackDays = sourceConfig.lookbackDays as string | undefined
    if (lookbackDays && (Number.isNaN(Number(lookbackDays)) || Number(lookbackDays) <= 0)) {
      return { valid: false, error: 'Lookback window must be a positive number of days' }
    }

    const spaceTypes = sourceConfig.spaceTypes
    if (
      spaceTypes != null &&
      spaceTypes !== '' &&
      !['SPACE', 'SPACE_AND_GROUP_CHAT', 'ALL'].includes(String(spaceTypes))
    ) {
      return { valid: false, error: 'Unsupported space type selection' }
    }

    try {
      const params = new URLSearchParams({ pageSize: '1' })
      const filter = buildSpacesFilter(sourceConfig)
      if (filter) params.set('filter', filter)

      const response = await fetchWithRetry(
        `${CHAT_API_BASE}/spaces?${params.toString()}`,
        { method: 'GET', headers: chatHeaders(accessToken) },
        VALIDATE_RETRY_OPTIONS
      )

      if (!response.ok) {
        const errorText = await response.text().catch(() => '')
        return {
          valid: false,
          error: `Google Chat access failed: ${response.status}${errorText ? ` — ${errorText.slice(0, 200)}` : ''}`,
        }
      }

      return { valid: true }
    } catch (error) {
      return { valid: false, error: getErrorMessage(error, 'Failed to validate configuration') }
    }
  },

  mapTags: (metadata: Record<string, unknown>): Record<string, unknown> => {
    const result: Record<string, unknown> = {}

    if (typeof metadata.spaceName === 'string') result.spaceName = metadata.spaceName
    if (typeof metadata.spaceType === 'string') result.spaceType = metadata.spaceType

    if (metadata.messageCount != null) {
      const count = Number(metadata.messageCount)
      if (!Number.isNaN(count)) result.messageCount = count
    }

    const lastActivity = parseTagDate(metadata.lastActivity)
    if (lastActivity) result.lastActivity = lastActivity

    return result
  },
}
