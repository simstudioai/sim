import { createLogger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import { fetchWithRetry, VALIDATE_RETRY_OPTIONS } from '@/lib/knowledge/documents/utils'
import { firefliesConnectorMeta } from '@/connectors/fireflies/meta'
import type { ConnectorConfig, ExternalDocument, ExternalDocumentList } from '@/connectors/types'
import { parseTagDate } from '@/connectors/utils'

const logger = createLogger('FirefliesConnector')

const FIREFLIES_GRAPHQL_URL = 'https://api.fireflies.ai/graphql'
const TRANSCRIPTS_PER_PAGE = 50

interface FirefliesTranscript {
  id: string
  title: string
  /** Milliseconds since EPOCH (UTC), per the Fireflies Transcript schema. */
  date: number
  /** Duration of the audio in **minutes**, per the Fireflies Transcript schema. */
  duration: number
  host_email?: string
  organizer_email?: string
  participants?: string[]
  transcript_url?: string
  speakers?: { name: string }[]
  sentences?: { speaker_name: string; text: string }[]
  summary?: {
    keywords?: string[]
    action_items?: string
    overview?: string
    short_summary?: string
  }
}

/**
 * Carries the Fireflies GraphQL error `code` so callers can tell a genuinely missing
 * object (`object_not_found`) from a transient fault (`too_many_requests`, 5xx).
 */
class FirefliesApiError extends Error {
  constructor(
    message: string,
    readonly code?: string
  ) {
    super(message)
    this.name = 'FirefliesApiError'
  }
}

/**
 * Executes a GraphQL query against the Fireflies API.
 */
async function firefliesGraphQL(
  accessToken: string,
  query: string,
  variables: Record<string, unknown> = {},
  retryOptions?: Parameters<typeof fetchWithRetry>[2]
): Promise<Record<string, unknown>> {
  const response = await fetchWithRetry(
    FIREFLIES_GRAPHQL_URL,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ query, variables }),
    },
    retryOptions
  )

  /**
   * Fireflies reports failures as an `errors` array in the body, and does so on
   * non-2xx responses too (`object_not_found` → 404, `too_many_requests` → 429,
   * `paid_required` → 403). Read the body first so the caller sees the actual
   * reason instead of a bare status code.
   */
  const data = (await response.json().catch(() => null)) as {
    data?: Record<string, unknown> | null
    errors?: { message?: string; code?: string }[]
  } | null

  const firstError = data?.errors?.[0]
  if (firstError) {
    const code = firstError.code ? ` (${firstError.code})` : ''
    throw new FirefliesApiError(
      `Fireflies API error${code}: ${firstError.message || 'Unknown GraphQL error'}`,
      firstError.code
    )
  }

  if (!response.ok) {
    throw new Error(`Fireflies API HTTP error: ${response.status}`)
  }

  /**
   * A 2xx carrying neither `errors` nor a `data` object is unreadable — an
   * unparseable body, a truncated response, a proxy interstitial. It must raise
   * rather than degrade to an empty result: `listDocuments` would otherwise
   * report a confident empty listing and the sync engine would reconcile every
   * stored document as deleted.
   */
  if (!data || typeof data.data !== 'object' || data.data === null) {
    throw new Error('Fireflies API returned a malformed response with no data')
  }

  return data.data
}

/**
 * Formats transcript sentences into plain text content.
 */
function formatTranscriptContent(transcript: FirefliesTranscript): string {
  const parts: string[] = []

  if (transcript.title) {
    parts.push(`Meeting: ${transcript.title}`)
  }

  if (transcript.date) {
    parts.push(`Date: ${new Date(transcript.date).toISOString()}`)
  }

  if (transcript.duration) {
    parts.push(`Duration: ${Math.round(transcript.duration)} minutes`)
  }

  const host = transcript.host_email || transcript.organizer_email
  if (host) {
    parts.push(`Host: ${host}`)
  }

  if (transcript.participants && transcript.participants.length > 0) {
    parts.push(`Participants: ${transcript.participants.join(', ')}`)
  }

  const overview = transcript.summary?.overview || transcript.summary?.short_summary
  if (overview) {
    parts.push('')
    parts.push('--- Overview ---')
    parts.push(overview)
  }

  if (transcript.summary?.action_items) {
    parts.push('')
    parts.push('--- Action Items ---')
    parts.push(transcript.summary.action_items)
  }

  if (transcript.summary?.keywords && transcript.summary.keywords.length > 0) {
    parts.push('')
    parts.push(`Keywords: ${transcript.summary.keywords.join(', ')}`)
  }

  if (transcript.sentences && transcript.sentences.length > 0) {
    parts.push('')
    parts.push('--- Transcript ---')
    for (const sentence of transcript.sentences) {
      parts.push(`${sentence.speaker_name}: ${sentence.text}`)
    }
  }

  return parts.join('\n')
}

/**
 * Builds the lightweight document stub shared by `listDocuments` and
 * `getDocument`, so the metadata-derived `contentHash` is byte-identical on both
 * paths and a hydrated transcript is never seen as changed.
 */
function transcriptToStub(transcript: FirefliesTranscript): ExternalDocument {
  const meetingDate = transcript.date ? new Date(transcript.date).toISOString() : undefined
  const speakerNames = transcript.speakers?.map((s) => s.name).filter(Boolean) ?? []

  return {
    externalId: transcript.id,
    title: transcript.title || 'Untitled Meeting',
    content: '',
    contentDeferred: true,
    mimeType: 'text/plain',
    sourceUrl: transcript.transcript_url || undefined,
    contentHash: `fireflies:${transcript.id}:${transcript.date ?? ''}:${transcript.duration ?? ''}`,
    metadata: {
      hostEmail: transcript.host_email || transcript.organizer_email,
      duration: transcript.duration,
      meetingDate,
      participants: transcript.participants,
      speakers: speakerNames,
    },
  }
}

export const firefliesConnector: ConnectorConfig = {
  ...firefliesConnectorMeta,

  listDocuments: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    cursor?: string,
    syncContext?: Record<string, unknown>
  ): Promise<ExternalDocumentList> => {
    const hostEmail = (sourceConfig.hostEmail as string) || ''
    const maxTranscripts = sourceConfig.maxTranscripts ? Number(sourceConfig.maxTranscripts) : 0

    const skip = cursor ? Number(cursor) : 0
    const prevFetched = (syncContext?.totalDocsFetched as number) ?? 0

    /**
     * `skip` is a raw offset and the API documents no ordering guarantee, so a
     * transcript created between two pages shifts the window and silently pushes
     * a still-existing transcript past the offset — reconciliation would read
     * that absence as a deletion. Pinning `toDate` to the moment the sync started
     * freezes the result set for the whole walk. It is an intentional scope
     * filter at sync start (never a cap), so it must not set `listingCapped`.
     */
    let listingCeiling = syncContext?.firefliesListingCeiling as string | undefined
    if (!listingCeiling) {
      listingCeiling = new Date().toISOString()
      if (syncContext) syncContext.firefliesListingCeiling = listingCeiling
    }

    /**
     * Under a cap, ask for one row beyond what is still needed. The probe row is
     * sliced off before it reaches the sync engine and exists only to tell
     * "the cap truncated a larger source" apart from "the cap happened to land
     * on the last transcript" — the two demand opposite `listingCapped` answers.
     */
    const remaining = maxTranscripts > 0 ? Math.max(0, maxTranscripts - prevFetched) : 0
    const pageSize =
      maxTranscripts > 0 ? Math.min(TRANSCRIPTS_PER_PAGE, remaining + 1) : TRANSCRIPTS_PER_PAGE

    const variables: Record<string, unknown> = {
      limit: pageSize,
      skip,
      toDate: listingCeiling,
    }

    if (hostEmail.trim()) {
      variables.host_email = hostEmail.trim()
    }

    logger.info('Listing Fireflies transcripts', {
      skip,
      limit: pageSize,
      hostEmailFilter: Boolean(hostEmail.trim()),
    })

    const data = await firefliesGraphQL(
      accessToken,
      `query Transcripts(
        $limit: Int
        $skip: Int
        $host_email: String
        $toDate: DateTime
      ) {
        transcripts(
          limit: $limit
          skip: $skip
          host_email: $host_email
          toDate: $toDate
        ) {
          id
          title
          date
          duration
          host_email
          organizer_email
          participants
          transcript_url
          speakers {
            name
          }
        }
      }`,
      variables
    )

    const transcripts = (
      Array.isArray(data.transcripts) ? data.transcripts : []
    ) as FirefliesTranscript[]

    const allStubs = transcripts.filter((t) => Boolean(t?.id)).map(transcriptToStub)
    const documents = maxTranscripts > 0 ? allStubs.slice(0, remaining) : allStubs

    const totalFetched = prevFetched + documents.length
    if (syncContext) syncContext.totalDocsFetched = totalFetched

    /**
     * `listingCapped` blocks the sync engine's deletion reconciliation, so it is
     * set only when the cap actually hid transcripts that still exist — either
     * the probe row came back, or the page came back full. A cap that lands
     * exactly on source exhaustion leaves a short page and stays reconcilable,
     * otherwise deleted meetings could never be removed from the KB.
     */
    const moreAvailable = allStubs.length > documents.length || transcripts.length === pageSize
    const hitLimit = maxTranscripts > 0 && totalFetched >= maxTranscripts
    if (hitLimit && moreAvailable && syncContext) syncContext.listingCapped = true

    const hasMore = !hitLimit && moreAvailable

    return {
      documents,
      /**
       * `skip` is an offset over the raw API result set, so it must advance by the
       * rows Fireflies returned — not by the stubs kept. Advancing by the kept
       * count would re-request any row dropped for a missing `id`. `hasMore` is
       * only ever true on the uncapped path, where nothing is sliced off.
       */
      nextCursor: hasMore ? String(skip + transcripts.length) : undefined,
      hasMore,
    }
  },

  getDocument: async (
    accessToken: string,
    _sourceConfig: Record<string, unknown>,
    externalId: string
  ): Promise<ExternalDocument | null> => {
    try {
      const data = await firefliesGraphQL(
        accessToken,
        `query Transcript($id: String!) {
          transcript(id: $id) {
            id
            title
            date
            duration
            host_email
            organizer_email
            participants
            transcript_url
            speakers {
              name
            }
            sentences {
              speaker_name
              text
            }
            summary {
              keywords
              action_items
              overview
              short_summary
            }
          }
        }`,
        { id: externalId }
      )

      const transcript = data.transcript as FirefliesTranscript | null
      if (!transcript?.id) return null

      const stub = transcriptToStub(transcript)

      return {
        ...stub,
        content: formatTranscriptContent(transcript),
        contentDeferred: false,
        metadata: {
          ...stub.metadata,
          keywords: transcript.summary?.keywords,
        },
      }
    } catch (error) {
      /**
       * Only `object_not_found` means the transcript is genuinely gone. Every other
       * failure — `too_many_requests`, `paid_required`, transport faults — is rethrown so
       * the sync engine records a failed row instead of silently dropping a transcript
       * that still exists.
       */
      if (error instanceof FirefliesApiError && error.code === 'object_not_found') {
        logger.info('Fireflies transcript not found', { externalId })
        return null
      }
      logger.warn('Failed to get Fireflies transcript', {
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
    const maxTranscripts = sourceConfig.maxTranscripts as string | undefined
    if (maxTranscripts && (Number.isNaN(Number(maxTranscripts)) || Number(maxTranscripts) < 0)) {
      return { valid: false, error: 'Max transcripts must be a non-negative number' }
    }

    try {
      await firefliesGraphQL(
        accessToken,
        `query User {
          user {
            user_id
            name
            email
          }
        }`,
        {},
        VALIDATE_RETRY_OPTIONS
      )

      return { valid: true }
    } catch (error) {
      const message = getErrorMessage(error, 'Failed to validate configuration')
      return { valid: false, error: message }
    }
  },

  mapTags: (metadata: Record<string, unknown>): Record<string, unknown> => {
    const result: Record<string, unknown> = {}

    if (typeof metadata.hostEmail === 'string') {
      result.hostEmail = metadata.hostEmail
    }

    const speakers = Array.isArray(metadata.speakers) ? (metadata.speakers as string[]) : []
    if (speakers.length > 0) {
      result.speakers = speakers.join(', ')
    }

    if (metadata.duration != null) {
      const num = Number(metadata.duration)
      if (!Number.isNaN(num)) result.duration = num
    }

    const meetingDate = parseTagDate(metadata.meetingDate)
    if (meetingDate) result.meetingDate = meetingDate

    return result
  },
}
