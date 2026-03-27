import { createLogger } from '@sim/logger'
import type {
  MothershipStreamV1EventEnvelope,
  MothershipStreamV1EventType as MothershipStreamV1EventTypeUnion,
  MothershipStreamV1StreamScope,
} from '@/lib/copilot/generated/mothership-stream-v1'
import { MothershipStreamV1EventType } from '@/lib/copilot/generated/mothership-stream-v1'
import type { StreamEvent } from './types'

const logger = createLogger('SessionEvent')

type JsonRecord = Record<string, unknown>

const VALID_EVENT_TYPES = new Set<string>(Object.values(MothershipStreamV1EventType))

export const TOOL_CALL_STATUS = {
  generating: 'generating',
} as const

export function createEvent(input: {
  streamId: string
  chatId?: string
  cursor: string
  seq: number
  requestId: string
  type: MothershipStreamV1EventTypeUnion
  payload: JsonRecord
  scope?: MothershipStreamV1StreamScope
  ts?: string
}): MothershipStreamV1EventEnvelope {
  const { streamId, chatId, cursor, seq, requestId, type, payload, scope, ts } = input

  return {
    v: 1,
    type,
    seq,
    ts: ts ?? new Date().toISOString(),
    stream: {
      streamId,
      ...(chatId ? { chatId } : {}),
      cursor,
    },
    trace: {
      requestId,
    },
    ...(scope ? { scope } : {}),
    payload,
  }
}

export function isEventRecord(value: unknown): value is MothershipStreamV1EventEnvelope {
  if (!value || typeof value !== 'object') {
    return false
  }

  const record = value as Record<string, unknown>
  return (
    record.v === 1 &&
    typeof record.type === 'string' &&
    VALID_EVENT_TYPES.has(record.type) &&
    typeof record.seq === 'number' &&
    typeof record.ts === 'string' &&
    !!record.stream &&
    typeof record.stream === 'object' &&
    typeof (record.stream as Record<string, unknown>).streamId === 'string' &&
    !!record.payload &&
    typeof record.payload === 'object'
  )
}

export function eventToStreamEvent(envelope: MothershipStreamV1EventEnvelope): StreamEvent {
  return {
    type: envelope.type,
    payload: asJsonRecord(envelope.payload),
    ...(envelope.scope ? { scope: envelope.scope } : {}),
  }
}

function asJsonRecord(value: unknown): JsonRecord {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as JsonRecord
  }
  logger.warn('Envelope payload is not a valid JSON record, defaulting to empty object')
  return {}
}
