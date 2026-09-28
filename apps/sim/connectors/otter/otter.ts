import { createLogger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import { toRecordOrNull } from '@sim/utils/object'
import { compareStrings } from '@sim/utils/string'
import { isPayloadSizeLimitError, readResponseTextWithLimit } from '@/lib/core/utils/stream-limits'
import { fetchWithRetry } from '@/lib/knowledge/documents/secure-fetch.server'
import {
  readBoundedHttpErrorPayload,
  VALIDATE_RETRY_OPTIONS,
} from '@/lib/knowledge/documents/utils'
import { otterConnectorMeta } from '@/connectors/otter/meta'
import type { ConnectorConfig, ExternalDocument, ExternalDocumentList } from '@/connectors/types'
import {
  CONNECTOR_TEXT_DOCUMENT_MAX_BYTES,
  computeContentHash,
  joinTagArray,
  markSkipped,
  parseOptionalUnlimitedSafeInteger,
  parseTagDate,
} from '@/connectors/utils'
import type { OtterConversation, OtterConversationDetail } from '@/tools/otter/types'
import {
  mapOtterConversation,
  mapOtterConversationDetail,
  OTTER_API_BASE,
  otterHeaders,
  readOtterDataList,
  readOtterDataObject,
  readOtterMeta,
} from '@/tools/otter/utils'

const logger = createLogger('OtterConnector')

/** Otter caps `limit` at 100 per page. */
const PAGE_SIZE = 100
/** A list page holds at most 100 conversation objects and never a transcript. */
const OTTER_MAX_LIST_RESPONSE_BYTES = 8 * 1024 * 1024
/** Upper bound on a single conversation response; transcripts are returned inline. */
const OTTER_MAX_RESPONSE_BYTES = 16 * 1024 * 1024
const MAX_CONVERSATIONS_VALIDATION_ERROR =
  'Max conversations must be a positive whole number, or 0 for unlimited'
const RESPONSE_TOO_LARGE_SKIP_REASON = `Conversation response exceeds the ${Math.round(
  OTTER_MAX_RESPONSE_BYTES / (1024 * 1024)
)}MB safe download limit and was not indexed`
const CONTENT_TOO_LARGE_SKIP_REASON = `Conversation notes exceed the ${Math.round(
  CONNECTOR_TEXT_DOCUMENT_MAX_BYTES / (1024 * 1024)
)}MB extracted-content limit and were not indexed`
const TRANSCRIPT_OMITTED_NOTICE =
  '[Transcript omitted: it exceeds the indexed text size limit. Open the conversation in Otter to read it.]'

function readChannelId(sourceConfig: Record<string, unknown>): string | undefined {
  const raw = sourceConfig.channelId
  return typeof raw === 'string' && raw.trim() ? raw.trim() : undefined
}

function includesTranscript(sourceConfig: Record<string, unknown>): boolean {
  return sourceConfig.includeTranscript !== 'false' && sourceConfig.includeTranscript !== false
}

function buildListUrl(sourceConfig: Record<string, unknown>, limit: number, cursor?: string) {
  const url = new URL(`${OTTER_API_BASE}/conversations`)
  const channelId = readChannelId(sourceConfig)
  // Otter overrides include_shared when channel_id is set, so it is only sent without one.
  if (channelId) {
    url.searchParams.set('channel_id', channelId)
  } else if (sourceConfig.scope === 'shared') {
    url.searchParams.set('include_shared', 'true')
  }
  url.searchParams.set('limit', String(limit))
  if (cursor) url.searchParams.set('cursor', cursor)
  return url.toString()
}

function displayUser(user: OtterConversation['owner']): string | undefined {
  if (!user) return undefined
  return user.name?.trim() || user.email?.trim() || undefined
}

function guestNames(conversation: OtterConversation): string[] {
  return conversation.calendarGuests
    .map((guest) => guest.name?.trim() || guest.email?.trim() || '')
    .filter(Boolean)
}

function channelNames(conversation: OtterConversation): string[] {
  return conversation.sharedChannels
    .map((share) => share.channel?.name?.trim() || '')
    .filter(Boolean)
}

/**
 * Change-detection hash from list metadata. Otter has no modification
 * timestamp, so the hash covers every list field that changes when Otter
 * finishes or regenerates notes (title, summary, processing status) or that
 * feeds a tag (owner, guests, channels), plus the transcript setting. The list
 * and detail endpoints return the same conversation object, so the hash is
 * identical on both paths. Action-item completion, insight and outline edits,
 * transcript edits, and custom-prompt output do not appear in list metadata;
 * they refresh on a full resync (`rehydrateOnFullSync`).
 */
async function buildContentHash(
  conversation: OtterConversation,
  withTranscript: boolean
): Promise<string> {
  const sorted = (values: string[]) => [...values].sort(compareStrings)
  const fingerprint = await computeContentHash(
    JSON.stringify({
      title: conversation.title,
      createdAt: conversation.createdAt,
      abstractSummary: conversation.abstractSummary,
      processStatus: conversation.processStatus,
      owner: displayUser(conversation.owner) ?? null,
      guests: sorted(guestNames(conversation)),
      channels: sorted(channelNames(conversation)),
    })
  )
  return `otter:${conversation.id}:${withTranscript ? 'transcript' : 'notes'}:${fingerprint}`
}

async function conversationToStub(
  conversation: OtterConversation,
  withTranscript: boolean
): Promise<ExternalDocument> {
  return {
    externalId: conversation.id,
    title: conversation.title?.trim() || 'Untitled Conversation',
    content: '',
    contentDeferred: true,
    mimeType: 'text/plain',
    sourceUrl: conversation.url ?? undefined,
    contentHash: await buildContentHash(conversation, withTranscript),
    // With transcripts the download, not the indexed text, bounds hydration memory.
    estimatedBytes: withTranscript ? OTTER_MAX_RESPONSE_BYTES : CONNECTOR_TEXT_DOCUMENT_MAX_BYTES,
    metadata: {
      owner: displayUser(conversation.owner),
      guests: guestNames(conversation),
      channels: channelNames(conversation),
      conversationDate: conversation.createdAt ?? undefined,
    },
  }
}

/** Render a conversation's notes (everything except the transcript) as plain text. */
function buildNotes(conversation: OtterConversationDetail): string {
  const lines: string[] = []
  const section = (heading: string) => {
    lines.push('', `## ${heading}`)
  }

  lines.push(`# ${conversation.title?.trim() || 'Untitled Conversation'}`)
  if (conversation.createdAt) lines.push(`Date: ${conversation.createdAt}`)
  const owner = displayUser(conversation.owner)
  if (owner) lines.push(`Owner: ${owner}`)
  const guests = conversation.calendarGuests
    .map((guest) =>
      guest.name && guest.email ? `${guest.name} <${guest.email}>` : guest.name || guest.email
    )
    .filter(Boolean)
  if (guests.length > 0) lines.push(`Calendar guests: ${guests.join(', ')}`)

  if (conversation.abstractSummary?.trim()) {
    section('Summary')
    lines.push(conversation.abstractSummary.trim())
  }

  if (conversation.actionItems && conversation.actionItems.length > 0) {
    section('Action Items')
    for (const item of conversation.actionItems) {
      if (!item.text?.trim()) continue
      const assignee = displayUser(item.assignee)
      const done = item.status?.completed ? ' (completed)' : ''
      lines.push(`- ${item.text.trim()}${assignee ? ` — ${assignee}` : ''}${done}`)
    }
  }

  if (conversation.insights && conversation.insights.length > 0) {
    section('Insights')
    for (const insight of conversation.insights) {
      if (insight.topic) lines.push(`### ${insight.topic}`)
      for (const point of insight.text) lines.push(`- ${point}`)
    }
  }

  if (conversation.outline && conversation.outline.length > 0) {
    section('Outline')
    for (const part of conversation.outline) {
      if (part.section) lines.push(`### ${part.section}`)
      for (const point of part.text) lines.push(`- ${point}`)
    }
  }

  if (conversation.customPrompt?.output?.trim()) {
    section(conversation.customPrompt.label?.trim() || 'Custom Prompt')
    lines.push(conversation.customPrompt.output.trim())
  }

  return lines.join('\n').trim()
}

/**
 * Render the indexable document. The notes are the most valuable part for
 * retrieval, so when the transcript would push the document past the text
 * limit the transcript is left out rather than dropping the whole conversation.
 */
function buildContent(
  conversation: OtterConversationDetail,
  transcriptTooLarge = false
): { content: string; transcriptOmitted: boolean } | null {
  const notes = buildNotes(conversation)
  if (Buffer.byteLength(notes, 'utf8') > CONNECTOR_TEXT_DOCUMENT_MAX_BYTES) return null
  if (transcriptTooLarge) {
    return {
      content: `${notes}\n\n## Transcript\n${TRANSCRIPT_OMITTED_NOTICE}`,
      transcriptOmitted: true,
    }
  }

  const transcript = conversation.transcript?.content?.trim()
  if (!transcript) return { content: notes, transcriptOmitted: false }

  const header = '\n\n## Transcript\n'
  const size =
    Buffer.byteLength(notes, 'utf8') +
    Buffer.byteLength(header, 'utf8') +
    Buffer.byteLength(transcript, 'utf8')
  if (size <= CONNECTOR_TEXT_DOCUMENT_MAX_BYTES) {
    return { content: `${notes}${header}${transcript}`, transcriptOmitted: false }
  }
  return {
    content: `${notes}\n\n## Transcript\n${TRANSCRIPT_OMITTED_NOTICE}`,
    transcriptOmitted: true,
  }
}

const NOTES_ONLY_INCLUDE = 'action_items,insights,outline'

/**
 * Fetch one conversation. Returns `'gone'` for a 404 and `'too-large'` when the
 * response exceeds the download cap; every other failure throws.
 */
async function fetchConversation(
  accessToken: string,
  externalId: string,
  include: string
): Promise<unknown | 'gone' | 'too-large'> {
  const url = new URL(`${OTTER_API_BASE}/conversations/${encodeURIComponent(externalId)}`)
  url.searchParams.set('include', include)

  const response = await fetchWithRetry(url.toString(), {
    method: 'GET',
    headers: otterHeaders(accessToken),
  })

  if (!response.ok) {
    await response.body?.cancel().catch(() => {})
    if (response.status === 404) return 'gone'
    throw new Error(`Failed to fetch Otter conversation: ${response.status}`)
  }

  try {
    return JSON.parse(
      await readResponseTextWithLimit(response, {
        maxBytes: OTTER_MAX_RESPONSE_BYTES,
        label: 'Otter conversation response',
      })
    )
  } catch (error) {
    if (isPayloadSizeLimitError(error)) return 'too-large'
    throw error
  }
}

/**
 * Read Otter's short error code (e.g. `unauthorized`, `not_found`) from a failed
 * response, draining at most the bounded error-body budget. Only a code-shaped
 * `error` string is kept; the raw body is never logged or surfaced.
 */
async function readOtterErrorCode(response: Response): Promise<string | null> {
  const payload = await readBoundedHttpErrorPayload(response)
  if (!payload.ok) return null
  try {
    const code = toRecordOrNull(JSON.parse(payload.body))?.error
    return typeof code === 'string' && /^[a-z_]{1,64}$/.test(code) ? code : null
  } catch {
    return null
  }
}

export const otterConnector: ConnectorConfig = {
  ...otterConnectorMeta,

  listDocuments: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    cursor?: string,
    syncContext?: Record<string, unknown>
  ): Promise<ExternalDocumentList> => {
    const maxConversations = parseOptionalUnlimitedSafeInteger(
      sourceConfig.maxConversations,
      MAX_CONVERSATIONS_VALIDATION_ERROR
    )
    const withTranscript = includesTranscript(sourceConfig)
    const prevFetched = (syncContext?.totalDocsFetched as number) ?? 0
    const remaining = maxConversations > 0 ? Math.max(0, maxConversations - prevFetched) : 0
    const pageSize = maxConversations > 0 ? Math.max(1, Math.min(PAGE_SIZE, remaining)) : PAGE_SIZE

    logger.info('Listing Otter conversations', {
      hasCursor: Boolean(cursor),
      scopedToChannel: Boolean(readChannelId(sourceConfig)),
      includeShared: sourceConfig.scope === 'shared',
    })

    const response = await fetchWithRetry(buildListUrl(sourceConfig, pageSize, cursor), {
      method: 'GET',
      headers: otterHeaders(accessToken),
    })

    if (!response.ok) {
      logger.error('Failed to list Otter conversations', {
        status: response.status,
        error: await readOtterErrorCode(response),
      })
      throw new Error(`Failed to list Otter conversations: ${response.status}`)
    }

    const body: unknown = JSON.parse(
      await readResponseTextWithLimit(response, {
        maxBytes: OTTER_MAX_LIST_RESPONSE_BYTES,
        label: 'Otter conversation list response',
      })
    )
    // A page without a `data` array or a boolean `has_more` throws rather than reading
    // as the complete source, which would reconcile every unseen conversation as deleted.
    const listed = readOtterDataList(body).map(mapOtterConversation)
    const conversations = listed.filter((conversation) => conversation.id)
    if (conversations.length < listed.length) {
      logger.warn('Otter returned conversations without an ID; skipping them', {
        skipped: listed.length - conversations.length,
      })
    }
    if (typeof toRecordOrNull(toRecordOrNull(body)?.meta)?.has_more !== 'boolean') {
      throw new Error('Unexpected Otter API response: missing meta.has_more')
    }
    const { hasMore: sourceHasMore, nextCursor } = readOtterMeta(body)

    const allStubs = await Promise.all(
      conversations.map((conversation) => conversationToStub(conversation, withTranscript))
    )
    let documents = allStubs
    let capDroppedConversations = false
    if (maxConversations > 0 && allStubs.length > remaining) {
      documents = allStubs.slice(0, remaining)
      capDroppedConversations = true
    }

    const totalFetched = prevFetched + documents.length
    if (syncContext) syncContext.totalDocsFetched = totalFetched

    const hitLimit = maxConversations > 0 && totalFetched >= maxConversations
    // Flag the cap only when it hid conversations that still exist, so a cap landing
    // exactly on the last conversation still lets deletions reconcile.
    if (syncContext && hitLimit && (capDroppedConversations || sourceHasMore)) {
      syncContext.listingCapped = true
    }

    // Report Otter's has_more verbatim: `hasMore` without a usable cursor fails the
    // listing ("pagination did not advance") instead of passing a partial page off
    // as the complete source.
    const hasMore = !hitLimit && sourceHasMore

    return {
      documents,
      nextCursor: hasMore ? (nextCursor ?? undefined) : undefined,
      hasMore,
    }
  },

  getDocument: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    externalId: string
  ): Promise<ExternalDocument | null> => {
    if (!externalId) return null
    const withTranscript = includesTranscript(sourceConfig)
    try {
      let body = await fetchConversation(
        accessToken,
        externalId,
        withTranscript ? 'all' : NOTES_ONLY_INCLUDE
      )
      let transcriptTooLarge = false
      // The transcript is the only unbounded part of a conversation, so an oversized
      // full response is retried without it and the notes are still indexed.
      if (body === 'too-large' && withTranscript) {
        logger.info(
          'Otter conversation response exceeds the download limit; retrying without transcript',
          {
            externalId,
            maxBytes: OTTER_MAX_RESPONSE_BYTES,
          }
        )
        transcriptTooLarge = true
        body = await fetchConversation(accessToken, externalId, NOTES_ONLY_INCLUDE)
      }
      if (body === 'gone') return null
      if (body === 'too-large') {
        logger.warn('Otter conversation response exceeds the download limit; skipping', {
          externalId,
          maxBytes: OTTER_MAX_RESPONSE_BYTES,
        })
        return markSkipped(
          {
            externalId,
            title: `Otter conversation ${externalId}`,
            content: '',
            contentDeferred: true,
            mimeType: 'text/plain',
            contentHash: `otter:oversized-response:${externalId}`,
          },
          RESPONSE_TOO_LARGE_SKIP_REASON
        )
      }

      const detail = mapOtterConversationDetail(readOtterDataObject(body), body)
      if (!detail.id) {
        throw new Error(`Otter returned conversation ${externalId} without an ID`)
      }

      const stub = await conversationToStub(detail, withTranscript)
      const built = buildContent(detail, transcriptTooLarge)
      if (!built) {
        logger.warn('Otter conversation notes exceed the text limit; skipping', { externalId })
        return markSkipped(stub, CONTENT_TOO_LARGE_SKIP_REASON)
      }
      if (built.transcriptOmitted) {
        logger.info('Otter transcript exceeds the text limit; indexing notes only', {
          externalId,
        })
      }

      return {
        ...stub,
        content: built.content,
        contentDeferred: false,
        estimatedBytes: Buffer.byteLength(built.content, 'utf8'),
      }
    } catch (error) {
      // Only a confirmed 404 returns null. Rate limits (10 req/s), 5xx, and network
      // faults rethrow so the sync engine keeps the already-indexed document.
      logger.warn('Failed to get Otter conversation', {
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
    try {
      parseOptionalUnlimitedSafeInteger(
        sourceConfig.maxConversations,
        MAX_CONVERSATIONS_VALIDATION_ERROR
      )
    } catch (error) {
      return { valid: false, error: getErrorMessage(error, MAX_CONVERSATIONS_VALIDATION_ERROR) }
    }

    try {
      const response = await fetchWithRetry(
        buildListUrl(sourceConfig, 1),
        { method: 'GET', headers: otterHeaders(accessToken) },
        VALIDATE_RETRY_OPTIONS
      )

      if (!response.ok) {
        if (response.status === 401) {
          return { valid: false, error: 'Invalid Otter API key' }
        }
        if (response.status === 403) {
          return {
            valid: false,
            error: 'Otter denied access. The Public API requires an Enterprise workspace.',
          }
        }
        if (response.status === 404 && readChannelId(sourceConfig)) {
          return { valid: false, error: 'Otter channel not found' }
        }
        const code = await readOtterErrorCode(response)
        return {
          valid: false,
          error: `Otter access failed: ${response.status}${code ? ` (${code})` : ''}`,
        }
      }

      await response.body?.cancel().catch(() => {})
      return { valid: true }
    } catch (error) {
      return { valid: false, error: getErrorMessage(error, 'Failed to validate configuration') }
    }
  },

  mapTags: (metadata: Record<string, unknown>): Record<string, unknown> => {
    const result: Record<string, unknown> = {}

    if (typeof metadata.owner === 'string' && metadata.owner.trim()) {
      result.owner = metadata.owner.trim()
    }

    const guests = joinTagArray(metadata.guests)
    if (guests) result.guests = guests

    const channels = joinTagArray(metadata.channels)
    if (channels) result.channels = channels

    const conversationDate = parseTagDate(metadata.conversationDate)
    if (conversationDate) result.conversationDate = conversationDate

    return result
  },
}
