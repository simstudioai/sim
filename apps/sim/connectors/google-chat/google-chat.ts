import { createHash } from 'node:crypto'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import Decimal from 'decimal.js'
import {
  readResponseJsonWithLimit,
  readResponseToBufferWithLimit,
} from '@/lib/core/utils/stream-limits'
import { fetchWithRetry } from '@/lib/knowledge/documents/secure-fetch.server'
import { VALIDATE_RETRY_OPTIONS } from '@/lib/knowledge/documents/utils'
import {
  DEFAULT_MAX_MESSAGES,
  googleChatConnectorMeta,
  MESSAGES_PAGE_SIZE,
  SPACES_PAGE_SIZE,
} from '@/connectors/google-chat/meta'
import type { ConnectorConfig, ExternalDocument, ExternalDocumentList } from '@/connectors/types'
import {
  BoundedLines,
  CONNECTOR_TEXT_DOCUMENT_MAX_BYTES,
  parseOptionalUnlimitedSafeInteger,
  parseTagDate,
} from '@/connectors/utils'

const logger = createLogger('GoogleChatConnector')

const CHAT_API_BASE = 'https://chat.googleapis.com/v1'
const MS_PER_DAY = 24 * 60 * 60 * 1000
const MAX_MESSAGE_PAGES = 200
const MAX_MESSAGE_RESPONSE_BYTES = 32 * 1024 * 1024
const MAX_SPACE_RESPONSE_BYTES = 8 * 1024 * 1024
const SPACE_FIELDS =
  'name,displayName,spaceType,spaceUri,lastActiveTime,spaceDetails(description,guidelines)'
const MESSAGE_FIELDS =
  'nextPageToken,messages(createTime,sender(name,displayName),text,fallbackText)'

/** `syncContext` key holding the spaces this run listed, keyed by resource name. */
const SPACE_CACHE_KEY = 'googleChatSpaces'

/** `syncContext` key holding this run's fallback activity token. */
const ACTIVITY_TOKEN_KEY = 'googleChatActivityToken'
const LOOKBACK_CUTOFF_KEY = 'googleChatLookbackCutoff'

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
  /** Output only. Timestamp of the last message in the space. */
  lastActiveTime?: string
  spaceDetails?: { description?: string; guidelines?: string }
}

interface SpacesListResponse {
  spaces?: Space[]
  nextPageToken?: string
}

/** Message authors can omit display names; retain the stable resource name as a fallback. */
interface ChatUser {
  name?: string
  displayName?: string
}

/**
 * A message in a space. `text` is the plain-text body; `fallbackText` is the
 * plain-text description of a card-only message.
 *
 * https://developers.google.com/workspace/chat/api/reference/rest/v1/spaces.messages
 */
interface ChatMessage {
  sender?: ChatUser
  createTime?: string
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

function resolvePositiveInteger(value: unknown, fallback: number, label: string): number {
  if (value == null || (typeof value === 'string' && value.trim() === '')) return fallback
  const error = `${label} must be a positive whole number`
  const parsed = parseOptionalUnlimitedSafeInteger(normalizeSavedInteger(value), error)
  if (parsed === 0) throw new Error(error)
  return parsed
}

/** Check the original decimal before converting legacy numeric strings to JavaScript numbers. */
function normalizeSavedInteger(value: unknown): unknown {
  if (typeof value !== 'string' || value.trim() === '') return value
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed)) return value
  try {
    return new Decimal(value.trim()).isInteger() ? parsed : value
  } catch {
    return value
  }
}

/** One cutoff per run keeps hydration consistent while inactive spaces age out on later syncs. */
function lookbackCutoff(days: number, syncContext?: Record<string, unknown>): string | undefined {
  if (days === 0) return undefined
  const key = `${LOOKBACK_CUTOFF_KEY}:${days}`
  const cached = syncContext?.[key]
  if (typeof cached === 'string') return cached
  const date = new Date(Date.now() - days * MS_PER_DAY)
  if (!Number.isFinite(date.getTime()))
    throw new Error('Lookback window is outside the supported date range')
  const cutoff = date.toISOString()
  if (syncContext) syncContext[key] = cutoff
  return cutoff
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
 * taken, since it re-reads the space's content on every sync.
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
 * Metadata identifies the source version; the cutoff identifies this run's window.
 *
 * Known limitation: editing or deleting an existing message does not advance
 * `lastActiveTime`, so such a change is only picked up once a newer message
 * lands or an explicit full resync runs — see `rehydrateOnFullSync` in `meta.ts`.
 */
function buildContentHash(
  space: Space,
  maxMessages: number,
  lookbackDays: number,
  cutoff: string | undefined,
  syncContext?: Record<string, unknown>
): string {
  const token = activityToken(space, syncContext)
  const version = createHash('sha256')
    .update(
      JSON.stringify([
        space.name,
        token,
        maxMessages,
        lookbackDays,
        spaceTitle(space),
        space.spaceType,
        space.spaceUri,
        space.spaceDetails?.description,
        space.spaceDetails?.guidelines,
      ])
    )
    .digest('hex')
  return `gchat:v3:${version}:${cutoff ? Date.parse(cutoff) : 'all'}`
}

const CONTENT_HASH =
  /^gchat:v3:([0-9a-f]{64}):(all|-?\d+)(?::(none|unknown|-?\d+):([0-9a-f]{64}))?$/

/**
 * Reuse a transcript while its source version is unchanged and no fetched message
 * has aged out. Hydrated text equality advances metadata without re-embedding,
 * using the same engine contract as Slack and Otter. Legacy hashes refresh once.
 */
function matchContentHash(candidate: string, stored: string): 'current' | 'equivalent' | 'stale' {
  const next = CONTENT_HASH.exec(candidate)
  const previous = CONTENT_HASH.exec(stored)
  if (!next || !previous?.[4]) return 'stale'
  if (next[4]) return next[4] === previous[4] ? 'equivalent' : 'stale'
  if (next[1] !== previous[1]) return 'stale'
  if (next[2] === previous[2]) return 'current'
  if (next[2] === 'all' || previous[2] === 'all' || Number(next[2]) < Number(previous[2]))
    return 'stale'
  if (previous[3] === 'none') return 'current'
  return previous[3] !== 'unknown' && Number(next[2]) < Number(previous[3]) ? 'current' : 'stale'
}

/** Unknown creation times force a reread; an exhausted empty window has no expiry. */
function oldestMessageTime(messages: ChatMessage[]): string {
  let oldest = Number.POSITIVE_INFINITY
  for (const message of messages) {
    const created = Date.parse(message.createTime ?? '')
    if (!Number.isFinite(created)) return 'unknown'
    oldest = Math.min(oldest, created)
  }
  return oldest === Number.POSITIVE_INFINITY ? 'none' : String(oldest)
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
  cutoff: string | undefined,
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
    contentHash: buildContentHash(space, maxMessages, lookbackDays, cutoff, syncContext),
    metadata: {
      spaceName: spaceTitle(space),
      spaceType: space.spaceType,
      lastActivity: space.lastActiveTime,
    },
  }
}

/** Fetches a single space. Returns null on 404 (space deleted or left). */
async function fetchSpace(accessToken: string, name: string): Promise<Space | null> {
  const params = new URLSearchParams({ fields: SPACE_FIELDS })
  const response = await fetchWithRetry(`${CHAT_API_BASE}/${name}?${params}`, {
    method: 'GET',
    headers: chatHeaders(accessToken),
  })
  if (!response.ok) {
    if (response.status === 404) return null
    throw new Error(`Failed to fetch Google Chat space: ${response.status}`)
  }
  return readResponseJsonWithLimit<Space>(response, {
    maxBytes: MAX_SPACE_RESPONSE_BYTES,
    label: 'Google Chat space response',
  })
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
  cutoff: string | undefined
): Promise<ChatMessage[]> {
  const filter = cutoff ? `createTime > "${cutoff}"` : undefined
  const pageSize = Math.min(MESSAGES_PAGE_SIZE, maxMessages)

  const collected: ChatMessage[] = []
  let pageToken: string | undefined
  const seenPageTokens = new Set<string>()

  let remainingBytes = MAX_MESSAGE_RESPONSE_BYTES
  let pages = 0
  while (collected.length < maxMessages) {
    if (pages >= MAX_MESSAGE_PAGES) throw new Error('Google Chat message page limit exceeded')
    pages++
    const params = new URLSearchParams({
      pageSize: String(pageSize),
      orderBy: 'createTime DESC',
      fields: MESSAGE_FIELDS,
    })
    if (filter) params.set('filter', filter)
    if (pageToken) params.set('pageToken', pageToken)

    const response = await fetchWithRetry(
      `${CHAT_API_BASE}/${spaceName}/messages?${params.toString()}`,
      { method: 'GET', headers: chatHeaders(accessToken) }
    )
    if (!response.ok) {
      throw new Error(`Failed to list Google Chat messages: ${response.status}`)
    }

    const buffer = await readResponseToBufferWithLimit(response, {
      maxBytes: remainingBytes,
      label: 'Google Chat messages response',
    })
    remainingBytes -= buffer.byteLength
    const data = JSON.parse(buffer.toString('utf8')) as MessagesListResponse
    const messages = data.messages ?? []
    collected.push(...messages)

    pageToken = data.nextPageToken?.trim() || undefined
    if (!pageToken) break
    if (seenPageTokens.has(pageToken))
      throw new Error('Google Chat returned a repeated message page token')
    seenPageTokens.add(pageToken)
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
function formatSpaceContent(
  space: Space,
  messages: ChatMessage[]
): { content: string; messageCount: number } {
  /** The newest messages survive when the window does not fit; the header always does. */
  const parts = new BoundedLines(CONNECTOR_TEXT_DOCUMENT_MAX_BYTES, 'last')
  parts.pin(`Space: ${spaceTitle(space)}`)
  const description = space.spaceDetails?.description?.trim()
  if (description) parts.pin(`Description: ${description}`)
  const guidelines = space.spaceDetails?.guidelines?.trim()
  if (guidelines) parts.pin(`Guidelines: ${guidelines}`)

  let headed = false
  for (const message of messages) {
    const text = message.text?.trim() || message.fallbackText?.trim()
    if (!text) continue
    if (!headed) {
      parts.pin('', '--- Messages ---')
      headed = true
    }
    const timestamp = message.createTime ?? ''
    parts.push(`[${timestamp}] ${senderLabel(message.sender)}: ${text}`)
  }

  return { content: parts.join(), messageCount: parts.count }
}

export const googleChatConnector: ConnectorConfig = {
  ...googleChatConnectorMeta,
  matchContentHash,

  listDocuments: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    cursor?: string,
    syncContext?: Record<string, unknown>
  ): Promise<ExternalDocumentList> => {
    const maxSpaces = parseOptionalUnlimitedSafeInteger(
      normalizeSavedInteger(sourceConfig.maxSpaces),
      'Max spaces must be a non-negative whole number'
    )
    const maxMessages = resolvePositiveInteger(
      sourceConfig.maxMessages,
      DEFAULT_MAX_MESSAGES,
      'Max messages per space'
    )
    const lookbackDays = resolvePositiveInteger(sourceConfig.lookbackDays, 0, 'Lookback window')
    const cutoff = lookbackCutoff(lookbackDays, syncContext)
    const prevFetched = (syncContext?.totalDocsFetched as number) ?? 0

    const pageSize =
      maxSpaces > 0
        ? Math.min(SPACES_PAGE_SIZE, Math.max(1, maxSpaces - prevFetched))
        : SPACES_PAGE_SIZE
    const params = new URLSearchParams({
      pageSize: String(pageSize),
      fields: `nextPageToken,spaces(${SPACE_FIELDS})`,
    })
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
      logger.error('Failed to list Google Chat spaces', {
        status: response.status,
      })
      throw new Error(`Failed to list Google Chat spaces: ${response.status}`)
    }

    const data = await readResponseJsonWithLimit<SpacesListResponse>(response, {
      maxBytes: MAX_SPACE_RESPONSE_BYTES,
      label: 'Google Chat spaces response',
    })
    const spaces = (data.spaces ?? []).filter((space) => Boolean(space.name))
    const nextPageToken = data.nextPageToken?.trim() || undefined

    const missingActivity = spaces.filter((space) => !space.lastActiveTime?.trim()).length
    if (missingActivity > 0) {
      logger.warn(
        'Google Chat spaces listed without lastActiveTime; their content is fetched every sync',
        { spacesMissingLastActiveTime: missingActivity, spacesInPage: spaces.length }
      )
    }

    cacheSpaces(spaces, syncContext)

    const allDocuments = spaces.map((space) =>
      spaceToStub(space, maxMessages, lookbackDays, cutoff, syncContext)
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
     * per document, it keeps the hydrated source version consistent with the
     * stub: re-reading the space here could observe a `lastActiveTime` that
     * advanced after the listing, storing a hash for messages this call never
     * fetched and hiding them until the *next* message arrives.
     */
    const space = cachedSpace(spaceName, syncContext) ?? (await fetchSpace(accessToken, spaceName))
    if (!space) return null

    const maxMessages = resolvePositiveInteger(
      sourceConfig.maxMessages,
      DEFAULT_MAX_MESSAGES,
      'Max messages per space'
    )
    const lookbackDays = resolvePositiveInteger(sourceConfig.lookbackDays, 0, 'Lookback window')
    const cutoff = lookbackCutoff(lookbackDays, syncContext)
    const messages = await fetchSpaceMessages(accessToken, spaceName, maxMessages, cutoff)

    /**
     * A space with no messages in the window is still a live space, so it is
     * indexed rather than skipped. `null` is this connector's "document is gone"
     * signal, and the engine treats it as last-known-good: returning it here would
     * both drop spaces whose only prose is their description or guidelines, and
     * leave a previously indexed transcript in place after the space was cleared
     * or `lookbackDays` was tightened past every message.
     */
    const { content, messageCount } = formatSpaceContent(space, messages)
    const stub = spaceToStub(space, maxMessages, lookbackDays, cutoff, syncContext)

    return {
      ...stub,
      content,
      contentHash: `${stub.contentHash}:${oldestMessageTime(messages)}:${createHash('sha256').update(content).digest('hex')}`,
      contentDeferred: false,
      metadata: { ...stub.metadata, messageCount },
    }
  },

  validateConfig: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>
  ): Promise<{ valid: boolean; error?: string }> => {
    try {
      resolvePositiveInteger(
        sourceConfig.maxMessages,
        DEFAULT_MAX_MESSAGES,
        'Max messages per space'
      )
      resolvePositiveInteger(sourceConfig.maxSpaces, 0, 'Max spaces')
      lookbackCutoff(resolvePositiveInteger(sourceConfig.lookbackDays, 0, 'Lookback window'))
    } catch (error) {
      return { valid: false, error: getErrorMessage(error) }
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
      const params = new URLSearchParams({ pageSize: '1', fields: 'spaces(name)' })
      const filter = buildSpacesFilter(sourceConfig)
      if (filter) params.set('filter', filter)

      const response = await fetchWithRetry(
        `${CHAT_API_BASE}/spaces?${params.toString()}`,
        { method: 'GET', headers: chatHeaders(accessToken) },
        VALIDATE_RETRY_OPTIONS
      )

      if (!response.ok) {
        return {
          valid: false,
          error: `Google Chat access failed: ${response.status}`,
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
