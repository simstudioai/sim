/**
 * The client half of the mothership stream wire (revamp M6 extraction, behavior-
 * preserving): batch parse + schema enforcement, cursor/terminal-state predicates, the
 * stream-gone error class, and the replay-stream builder — pure module-scope helpers
 * moved verbatim out of use-chat.ts.
 */
import { isRecordLike } from '@sim/utils/object'
import {
  MothershipStreamV1EventType,
  MothershipStreamV1SessionKind,
} from '@/lib/mothership/generated/mothership-stream-v1'
import {
  type ParseStreamEventEnvelopeFailure,
  parsePersistedStreamEventEnvelope,
} from '@/lib/mothership/request/session/contract'
import {
  type FilePreviewSession,
  isFilePreviewSession,
} from '@/lib/mothership/request/session/file-preview-session-contract'
import type { StreamBatchEvent } from '@/lib/mothership/request/session/types'

export type StreamBatchResponse = {
  success: boolean
  events: StreamBatchEvent[]
  previewSessions?: FilePreviewSession[]
  status: string
  chatId?: string
}

const STREAM_SCHEMA_ENFORCEMENT_PREFIX = 'Client stream schema enforcement failed.'

class StreamSchemaValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StreamSchemaValidationError'
  }
}

export function createStreamSchemaValidationError(
  failure: ParseStreamEventEnvelopeFailure,
  context?: string
): StreamSchemaValidationError {
  const details = failure.errors?.filter(Boolean).join('; ')
  return new StreamSchemaValidationError(
    [STREAM_SCHEMA_ENFORCEMENT_PREFIX, context, failure.message, details].filter(Boolean).join(' ')
  )
}

export function createBatchSchemaValidationError(message: string): StreamSchemaValidationError {
  return new StreamSchemaValidationError([STREAM_SCHEMA_ENFORCEMENT_PREFIX, message].join(' '))
}

export function isStreamSchemaValidationError(
  error: unknown
): error is StreamSchemaValidationError {
  return error instanceof StreamSchemaValidationError
}

export function parseStreamBatchResponse(value: unknown): StreamBatchResponse {
  if (!isRecordLike(value)) {
    throw new Error('Invalid stream batch response')
  }

  const rawEvents = Array.isArray(value.events) ? value.events : []
  const events: StreamBatchEvent[] = []
  for (const [index, entry] of rawEvents.entries()) {
    if (!isRecordLike(entry)) {
      throw createBatchSchemaValidationError(`Reconnect batch event ${index + 1} is not an object.`)
    }
    if (
      typeof entry.eventId !== 'number' ||
      !Number.isFinite(entry.eventId) ||
      typeof entry.streamId !== 'string'
    ) {
      throw createBatchSchemaValidationError(
        `Reconnect batch event ${index + 1} is missing required metadata.`
      )
    }

    const parsedEvent = parsePersistedStreamEventEnvelope(entry.event)
    if (!parsedEvent.ok) {
      throw createStreamSchemaValidationError(parsedEvent, `Reconnect batch event ${index + 1}.`)
    }

    events.push({
      eventId: entry.eventId,
      streamId: entry.streamId,
      event: parsedEvent.event,
    })
  }

  const rawPreviewSessions = Array.isArray(value.previewSessions)
    ? value.previewSessions
    : undefined
  const previewSessions =
    rawPreviewSessions?.map((session, index) => {
      if (!isFilePreviewSession(session)) {
        throw createBatchSchemaValidationError(
          `Reconnect preview session ${index + 1} failed validation.`
        )
      }
      return session
    }) ?? undefined

  return {
    success: value.success === true,
    events,
    ...(previewSessions ? { previewSessions } : {}),
    status: typeof value.status === 'string' ? value.status : 'unknown',
    ...(typeof value.chatId === 'string' && value.chatId ? { chatId: value.chatId } : {}),
  }
}

export function resolveChatIdFromStreamBatch(batch: StreamBatchResponse): string | undefined {
  if (batch.chatId) return batch.chatId

  for (const { event } of batch.events) {
    const streamChatId = typeof event.stream?.chatId === 'string' ? event.stream.chatId : undefined
    if (streamChatId) return streamChatId
    if (
      event.type === MothershipStreamV1EventType.session &&
      event.payload.kind === MothershipStreamV1SessionKind.chat
    ) {
      return event.payload.chatId
    }
  }

  return undefined
}

export function isAlreadyProcessedStreamCursor(
  eventCursor: string | undefined,
  currentCursor: string
): boolean {
  if (!eventCursor) return false

  const eventSequence = Number(eventCursor)
  const currentSequence = Number(currentCursor)
  return (
    Number.isFinite(eventSequence) &&
    Number.isFinite(currentSequence) &&
    eventSequence <= currentSequence
  )
}

export function isZeroStreamCursor(cursor: string): boolean {
  const sequence = Number(cursor)
  return Number.isFinite(sequence) && sequence <= 0
}

/**
 * The resume endpoint 404s when no run exists for the stream — there is
 * nothing left to resume, so reconnect falls back to the persisted DB
 * transcript instead of retrying or surfacing an error.
 */
export class StreamGoneError extends Error {
  constructor(streamId: string) {
    super(`Stream ${streamId} no longer exists`)
    this.name = 'StreamGoneError'
  }
}

export function isStreamGoneError(error: unknown): error is StreamGoneError {
  return error instanceof Error && error.name === 'StreamGoneError'
}

const sseEncoder = new TextEncoder()
export function buildReplayStream(events: StreamBatchEvent[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      const payload = events.map((entry) => `data: ${JSON.stringify(entry.event)}\n\n`).join('')
      controller.enqueue(sseEncoder.encode(payload))
      controller.close()
    },
  })
}
