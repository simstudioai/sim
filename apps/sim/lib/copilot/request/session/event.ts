import {
  type PersistedStreamEventEnvelope,
  parsePersistedStreamEventEnvelope,
  type SessionStreamEvent,
} from './contract'

type CreateEventBase = {
  chatId?: string
  cursor: string
  requestId: string
  seq: number
  streamId: string
  ts?: string
}

type CreateEventVariant<TEvent extends SessionStreamEvent> = CreateEventBase &
  Pick<TEvent, 'type' | 'payload' | 'scope'>

export type CreateEventInput = SessionStreamEvent extends infer TEvent
  ? TEvent extends SessionStreamEvent
    ? CreateEventVariant<TEvent>
    : never
  : never

type CreateEventResult<TInput extends CreateEventInput> = Extract<
  PersistedStreamEventEnvelope,
  { type: TInput['type']; payload: TInput['payload'] }
>

type StreamEventFromEnvelope<TEnvelope extends PersistedStreamEventEnvelope> = Extract<
  SessionStreamEvent,
  { type: TEnvelope['type']; payload: TEnvelope['payload'] }
>

export const TOOL_CALL_STATUS = {
  generating: 'generating',
} as const

export function createEvent<TInput extends CreateEventInput>(
  input: TInput
): CreateEventResult<TInput> {
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
  } as CreateEventResult<TInput>
}

export function isEventRecord(value: unknown): value is PersistedStreamEventEnvelope {
  return parsePersistedStreamEventEnvelope(value).ok
}

export function eventToStreamEvent<TEnvelope extends PersistedStreamEventEnvelope>(
  envelope: TEnvelope
): StreamEventFromEnvelope<TEnvelope> {
  return {
    type: envelope.type,
    payload: envelope.payload,
    ...(envelope.scope ? { scope: envelope.scope } : {}),
  } as StreamEventFromEnvelope<TEnvelope>
}
