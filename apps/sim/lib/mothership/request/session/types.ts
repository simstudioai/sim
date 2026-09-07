import type { PersistedStreamEventEnvelope, SessionStreamEvent } from './contract'
import { parsePersistedStreamEventEnvelope } from './contract'

export type StreamEvent = SessionStreamEvent

export interface StreamBatchEvent {
  eventId: number
  streamId: string
  event: PersistedStreamEventEnvelope
}

/** Recovery refreshes canonical panels; it does not repeat historical focus commands. */
export function toReplayEnvelope(
  envelope: PersistedStreamEventEnvelope
): PersistedStreamEventEnvelope {
  if (envelope.type === 'resource') {
    return { ...envelope, payload: { ...envelope.payload, replay: true } }
  }
  if (
    envelope.type === 'tool' &&
    'phase' in envelope.payload &&
    envelope.payload.phase === 'result'
  ) {
    return { ...envelope, payload: { ...envelope.payload, replay: true } }
  }
  return envelope
}

export function toStreamBatchEvent(envelope: PersistedStreamEventEnvelope): StreamBatchEvent {
  return {
    eventId: envelope.seq,
    streamId: envelope.stream.streamId,
    event: toReplayEnvelope(envelope),
  }
}

export function isStreamBatchEvent(value: unknown): value is StreamBatchEvent {
  if (!value || typeof value !== 'object') {
    return false
  }

  const record = value as Record<string, unknown>
  if (
    typeof record.eventId !== 'number' ||
    !Number.isFinite(record.eventId) ||
    typeof record.streamId !== 'string'
  ) {
    return false
  }

  return parsePersistedStreamEventEnvelope(record.event).ok
}
