import { createLogger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import { z } from 'zod'
import { isPayloadSizeLimitError, readResponseTextWithLimit } from '@/lib/core/utils/stream-limits'
import {
  isRetryableError,
  type RetryOptions,
  resolveRetryDelayMs,
  retryWithExponentialBackoff,
  VALIDATE_RETRY_OPTIONS,
} from '@/lib/knowledge/documents/utils'
import { firefliesConnectorMeta } from '@/connectors/fireflies/meta'
import type { ConnectorConfig, ExternalDocument, ExternalDocumentList } from '@/connectors/types'
import {
  ConnectorFileTooLargeError,
  computeContentHash,
  markSkipped,
  parseOptionalUnlimitedSafeInteger,
  parseTagDate,
} from '@/connectors/utils'

const logger = createLogger('FirefliesConnector')

const FIREFLIES_GRAPHQL_URL = 'https://api.fireflies.ai/graphql'
const TRANSCRIPTS_PER_PAGE = 50
const FIREFLIES_MAX_RESPONSE_BYTES = 16 * 1024 * 1024
const FIREFLIES_MAX_EXTRACTED_CONTENT_BYTES = 8 * 1024 * 1024
const FIREFLIES_DEFAULT_MAX_RETRY_DELAY_MS = 120_000
const FIREFLIES_DEFAULT_MAX_RETRIES = 2
const FIREFLIES_EXTRACTED_CONTENT_SKIP_REASON =
  'Transcript exceeds the 8MB extracted-content limit and was not indexed'
const FIREFLIES_RESPONSE_SKIP_REASON =
  'Transcript response exceeds the 16MB safe hydration limit and was not indexed'
const MAX_TRANSCRIPTS_VALIDATION_ERROR =
  'Max transcripts must be a positive safe integer, or 0 for unlimited'

function parseMaxTranscripts(value: unknown): number {
  return parseOptionalUnlimitedSafeInteger(value, MAX_TRANSCRIPTS_VALIDATION_ERROR)
}

function parsePaginationCursor(cursor?: string): number {
  if (cursor === undefined) return 0
  if (!/^\d+$/.test(cursor)) {
    throw new Error('Invalid Fireflies connector pagination cursor')
  }
  const parsed = Number(cursor)
  if (!Number.isSafeInteger(parsed)) {
    throw new Error('Invalid Fireflies connector pagination cursor')
  }
  return parsed
}

const nullableStringSchema = z.string().nullable().optional()
const nullableFiniteNumberSchema = z.number().finite().nullable().optional()

const firefliesSpeakerSchema = z
  .object({
    name: nullableStringSchema,
  })
  .passthrough()
  .nullable()

const firefliesSentenceSchema = z
  .object({
    speaker_name: nullableStringSchema,
    text: nullableStringSchema,
  })
  .passthrough()
  .nullable()

const firefliesTranscriptSchema = z
  .object({
    /** A stable source ID is the only field the connector requires for document identity. */
    id: z.string().min(1),
    title: nullableStringSchema,
    /** Milliseconds since EPOCH (UTC), per the Fireflies Transcript schema. */
    date: z
      .number()
      .finite()
      .refine((value) => !Number.isNaN(new Date(value).getTime()))
      .nullable()
      .optional(),
    /** Duration of the audio in **minutes**, per the Fireflies Transcript schema. */
    duration: nullableFiniteNumberSchema,
    host_email: nullableStringSchema,
    organizer_email: nullableStringSchema,
    participants: z.array(z.string().nullable()).nullable().optional(),
    transcript_url: nullableStringSchema,
    speakers: z.array(firefliesSpeakerSchema).nullable().optional(),
    is_live: z.boolean().nullable().optional(),
    meeting_info: z
      .object({
        summary_status: nullableStringSchema,
      })
      .passthrough()
      .nullable()
      .optional(),
    sentences: z.array(firefliesSentenceSchema).nullable().optional(),
    summary: z
      .object({
        /** Fireflies documents a string; tolerate the historical array shape defensively. */
        keywords: z
          .union([z.string(), z.array(z.string().nullable())])
          .nullable()
          .optional(),
        action_items: nullableStringSchema,
        overview: nullableStringSchema,
        short_summary: nullableStringSchema,
      })
      .passthrough()
      .nullable()
      .optional(),
  })
  .passthrough()

type FirefliesTranscript = z.infer<typeof firefliesTranscriptSchema>

function parseFirefliesTranscript(value: unknown): FirefliesTranscript {
  const parsed = firefliesTranscriptSchema.safeParse(value)
  if (parsed.success) return parsed.data

  const invalidPaths = [
    ...new Set(
      parsed.error.issues.map((issue) =>
        issue.path.length > 0 ? issue.path.join('.') : 'transcript'
      )
    ),
  ].slice(0, 3)
  const detail = invalidPaths.length > 0 ? ` (${invalidPaths.join(', ')})` : ''
  throw new Error(`Fireflies API returned malformed transcript metadata${detail}`)
}

function compactStrings(values: (string | null)[] | null | undefined): string[] {
  return values?.filter((value): value is string => Boolean(value)) ?? []
}

function transcriptDateToIso(date: number | null | undefined): string | undefined {
  return date == null ? undefined : new Date(date).toISOString()
}

interface FirefliesGraphQLError {
  message?: string
  code?: string
  extensions?: {
    status?: number
    metadata?: { retryAfter?: number }
  }
}

/**
 * Carries the Fireflies GraphQL error `code` so callers can tell a genuinely missing
 * object (`object_not_found`) from a transient fault (`too_many_requests`, 5xx).
 */
class FirefliesApiError extends Error {
  constructor(
    message: string,
    readonly code?: string,
    readonly status?: number,
    readonly retryAfterMs?: number
  ) {
    super(message)
    this.name = 'FirefliesApiError'
  }
}

class FirefliesMalformedResponseError extends Error {
  constructor(status: number) {
    super(`Fireflies API returned a malformed response with no data (HTTP ${status})`)
    this.name = 'FirefliesMalformedResponseError'
  }
}

const FIREFLIES_RETRYABLE_ERROR_CODES = new Set([
  'too_many_requests',
  'request_timeout',
  'invariant_violation',
])

function isRetryableFirefliesError(error: unknown): boolean {
  if (error instanceof FirefliesMalformedResponseError) return true
  if (error instanceof FirefliesApiError) {
    return (
      (error.status !== undefined && error.status >= 500 && error.status <= 599) ||
      Boolean(error.code && FIREFLIES_RETRYABLE_ERROR_CODES.has(error.code)) ||
      isRetryableError(error)
    )
  }
  return isRetryableError(error)
}

/**
 * Executes a GraphQL query against the Fireflies API.
 */
async function firefliesGraphQL(
  accessToken: string,
  query: string,
  variables: Record<string, unknown> = {},
  retryOptions?: RetryOptions
): Promise<Record<string, unknown>> {
  return retryWithExponentialBackoff(
    async () => {
      /** One retry layer owns transport, HTTP, and GraphQL semantic failures. */
      const response = await fetch(FIREFLIES_GRAPHQL_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ query, variables }),
      })

      /**
       * Fireflies reports failures as an `errors` array in the body, and does so on
       * non-2xx responses too (`object_not_found` → 404, `too_many_requests` → 429,
       * `paid_required` → 403). Read the body first so the caller sees the actual
       * reason instead of a bare status code.
       */
      let rawBody: string
      try {
        rawBody = await readResponseTextWithLimit(response, {
          maxBytes: FIREFLIES_MAX_RESPONSE_BYTES,
          label: 'Fireflies GraphQL response',
        })
      } catch (error) {
        if (!response.ok && isPayloadSizeLimitError(error)) {
          throw new FirefliesApiError(
            `Fireflies API HTTP error: ${response.status} (response body exceeded the diagnostic limit)`,
            undefined,
            response.status,
            resolveRetryDelayMs(response.headers)
          )
        }
        throw error
      }

      let parsedBody: unknown = null
      try {
        parsedBody = JSON.parse(rawBody)
      } catch {
        parsedBody = null
      }

      const data = parsedBody as {
        data?: Record<string, unknown> | null
        errors?: FirefliesGraphQLError[]
      } | null
      const headerRetryAfterMs = resolveRetryDelayMs(response.headers)

      const firstError = data?.errors?.[0]
      if (firstError) {
        const safeCode =
          typeof firstError.code === 'string' && /^[A-Za-z0-9_.-]{1,64}$/.test(firstError.code)
            ? firstError.code
            : undefined
        const code = safeCode ? ` (${safeCode})` : ''
        const retryAt = firstError.extensions?.metadata?.retryAfter
        const graphQLRetryAfterMs =
          typeof retryAt === 'number' && retryAt > Date.now() ? retryAt - Date.now() : undefined
        throw new FirefliesApiError(
          `Fireflies API error${code}`,
          safeCode,
          firstError.extensions?.status ?? response.status,
          graphQLRetryAfterMs ?? headerRetryAfterMs
        )
      }

      if (!response.ok) {
        throw new FirefliesApiError(
          `Fireflies API HTTP error: ${response.status} (response body omitted)`,
          undefined,
          response.status,
          headerRetryAfterMs
        )
      }

      /**
       * A 2xx carrying neither `errors` nor a `data` object is unreadable — an
       * unparseable body, a truncated response, or a proxy interstitial. It must
       * raise rather than degrade to an empty result: `listDocuments` would
       * otherwise report a confident empty listing and reconcile every stored
       * document as deleted. Retrying at the page boundary preserves prior pages.
       */
      if (!data || typeof data.data !== 'object' || data.data === null) {
        throw new FirefliesMalformedResponseError(response.status)
      }

      return data.data
    },
    {
      maxRetries: retryOptions?.maxRetries ?? FIREFLIES_DEFAULT_MAX_RETRIES,
      initialDelayMs: retryOptions?.initialDelayMs ?? 1000,
      maxDelayMs: retryOptions?.maxDelayMs ?? FIREFLIES_DEFAULT_MAX_RETRY_DELAY_MS,
      maxRetryAfterMs:
        retryOptions?.maxRetryAfterMs ??
        retryOptions?.maxDelayMs ??
        FIREFLIES_DEFAULT_MAX_RETRY_DELAY_MS,
      backoffMultiplier: retryOptions?.backoffMultiplier,
      retryCondition: isRetryableFirefliesError,
    }
  )
}

function formatTranscriptContent(transcript: FirefliesTranscript): string {
  const parts: string[] = []
  let totalBytes = 0
  const push = (part: string) => {
    const addedBytes = Buffer.byteLength(part, 'utf8') + (parts.length > 0 ? 1 : 0)
    if (totalBytes + addedBytes > FIREFLIES_MAX_EXTRACTED_CONTENT_BYTES) {
      throw new ConnectorFileTooLargeError(FIREFLIES_MAX_EXTRACTED_CONTENT_BYTES)
    }
    parts.push(part)
    totalBytes += addedBytes
  }

  if (transcript.title) {
    push(`Meeting: ${transcript.title}`)
  }

  const meetingDate = transcriptDateToIso(transcript.date)
  if (meetingDate) {
    push(`Date: ${meetingDate}`)
  }

  if (transcript.duration != null) {
    push(`Duration: ${Math.round(transcript.duration)} minutes`)
  }

  const host = transcript.host_email || transcript.organizer_email
  if (host) {
    push(`Host: ${host}`)
  }

  const participants = compactStrings(transcript.participants)
  if (participants.length > 0) {
    push(`Participants: ${participants.join(', ')}`)
  }

  const overview = transcript.summary?.overview || transcript.summary?.short_summary
  if (overview) {
    push('')
    push('--- Overview ---')
    push(overview)
  }

  if (transcript.summary?.action_items) {
    push('')
    push('--- Action Items ---')
    push(transcript.summary.action_items)
  }

  const keywords = transcript.summary?.keywords
  const formattedKeywords = Array.isArray(keywords)
    ? compactStrings(keywords).join(', ')
    : typeof keywords === 'string'
      ? keywords
      : ''
  if (formattedKeywords) {
    push('')
    push(`Keywords: ${formattedKeywords}`)
  }

  let transcriptHeaderAdded = false
  for (const sentence of transcript.sentences ?? []) {
    if (!sentence?.text) continue
    if (!transcriptHeaderAdded) {
      push('')
      push('--- Transcript ---')
      transcriptHeaderAdded = true
    }
    push(`${sentence.speaker_name || 'Unknown speaker'}: ${sentence.text}`)
  }

  return parts.join('\n')
}

/**
 * Builds the lightweight document stub shared by `listDocuments` and
 * `getDocument`, so the metadata-derived `contentHash` is byte-identical on both
 * paths and a hydrated transcript is never seen as changed.
 */
async function transcriptToStub(transcript: FirefliesTranscript): Promise<ExternalDocument> {
  const meetingDate = transcriptDateToIso(transcript.date)
  const hostEmail = transcript.host_email || transcript.organizer_email || undefined
  const participants = compactStrings(transcript.participants)
  const speakerNames =
    transcript.speakers?.flatMap((speaker) => (speaker?.name ? [speaker.name] : [])) ?? []
  const lifecycleHash = await computeContentHash(
    JSON.stringify({
      date: transcript.date ?? null,
      duration: transcript.duration ?? null,
      title: transcript.title ?? null,
      host: hostEmail ?? null,
      participants,
      speakers: speakerNames,
      isLive: transcript.is_live ?? null,
      summaryStatus: transcript.meeting_info?.summary_status ?? null,
    })
  )

  return {
    externalId: transcript.id,
    title: transcript.title || 'Untitled Meeting',
    content: '',
    contentDeferred: true,
    mimeType: 'text/plain',
    sourceUrl: transcript.transcript_url || undefined,
    contentHash: `fireflies:v2:${transcript.id}:${lifecycleHash}`,
    metadata: {
      hostEmail,
      duration: transcript.duration,
      meetingDate,
      participants,
      speakers: speakerNames,
    },
  }
}

function oversizedTranscriptResponseStub(externalId: string): ExternalDocument {
  return markSkipped(
    {
      externalId,
      title: `Fireflies transcript ${externalId}`,
      content: '',
      contentDeferred: true,
      mimeType: 'text/plain',
      contentHash: `fireflies:oversized-response:${externalId}`,
    },
    FIREFLIES_RESPONSE_SKIP_REASON
  )
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
    const maxTranscripts = parseMaxTranscripts(sourceConfig.maxTranscripts)

    const skip = parsePaginationCursor(cursor)
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
      if (syncContext) {
        syncContext.firefliesListingCeiling = listingCeiling
      }
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
          is_live
          meeting_info {
            summary_status
          }
        }
      }`,
      variables
    )

    if (!Array.isArray(data.transcripts)) {
      throw new Error('Fireflies API returned malformed transcript-list data')
    }
    const transcripts = data.transcripts.map(parseFirefliesTranscript)

    const allStubs = await Promise.all(transcripts.map(transcriptToStub))
    const documents = maxTranscripts > 0 ? allStubs.slice(0, remaining) : allStubs

    const totalFetched = prevFetched + documents.length
    if (syncContext) syncContext.totalDocsFetched = totalFetched

    /**
     * Record a configured cap only when it actually hid transcripts — either the
     * probe row came back, or the page came back full. The separate
     * `reconciliationSafe: false` result reflects the provider's offset pagination
     * regardless of whether this user-configured cap was reached.
     */
    const moreAvailable = allStubs.length > documents.length || transcripts.length === pageSize
    const hitLimit = maxTranscripts > 0 && totalFetched >= maxTranscripts
    if (hitLimit && moreAvailable && syncContext) syncContext.listingCapped = true

    const hasMore = !hitLimit && moreAvailable

    return {
      documents,
      /**
       * `skip` is an offset over the raw API result set, so it must advance by the
       * rows Fireflies returned — not by the documents retained under a configured
       * cap. `hasMore` is only ever true on the uncapped path, where nothing is sliced off.
       */
      nextCursor: hasMore ? String(skip + transcripts.length) : undefined,
      hasMore,
      /**
       * Fireflies exposes offset pagination without a documented stable sort or
       * snapshot cursor. `toDate` excludes new transcripts, but a deletion during
       * the walk can still shift later offsets and make a live item appear absent.
       */
      reconciliationSafe: false,
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
            is_live
            meeting_info {
              summary_status
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

      const transcript = parseFirefliesTranscript(data.transcript)
      if (transcript.id !== externalId) {
        throw new Error('Fireflies API returned malformed transcript metadata')
      }

      const stub = await transcriptToStub(transcript)
      let content: string
      try {
        content = formatTranscriptContent(transcript)
      } catch (error) {
        if (error instanceof ConnectorFileTooLargeError) {
          return markSkipped(stub, FIREFLIES_EXTRACTED_CONTENT_SKIP_REASON)
        }
        throw error
      }

      return {
        ...stub,
        content,
        contentDeferred: false,
        metadata: {
          ...stub.metadata,
          keywords: transcript.summary?.keywords,
        },
      }
    } catch (error) {
      if (isPayloadSizeLimitError(error)) {
        logger.info('Skipping Fireflies transcript with oversized hydration response', {
          externalId,
          maxResponseBytes: FIREFLIES_MAX_RESPONSE_BYTES,
        })
        return oversizedTranscriptResponseStub(externalId)
      }
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
    try {
      parseMaxTranscripts(sourceConfig.maxTranscripts)
    } catch (error) {
      return { valid: false, error: toError(error).message }
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
