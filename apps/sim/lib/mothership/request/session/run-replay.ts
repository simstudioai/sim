import { isRecordLike } from '@sim/utils/object'
import { MothershipStreamV1EventType } from '@/lib/mothership/generated/mothership-stream-v1'
import { type StreamReplayEnd, StreamReplayRequest } from '@/lib/mothership/generated/protocol'
import { TraceAttr } from '@/lib/mothership/generated/trace-attributes-v1'
import { fetchGo } from '@/lib/mothership/request/go/fetch'
import { FatalSseEventError, processSSEStream } from '@/lib/mothership/request/go/parser'
import { mothershipRequestHeaders } from '@/lib/mothership/request/headers'
import {
  type PersistedStreamEventEnvelope,
  parsePersistedStreamEventEnvelope,
} from '@/lib/mothership/request/session/contract'
import { getMothershipBaseURL } from '@/lib/mothership/server/agent-url'

const REPLAY_PATH = '/api/streams/replay'

/** How a worker replay leg ended: at the run's terminal, short of it, or cut off. */
export type RunReplayEnd = 'complete' | StreamReplayEnd['reason'] | 'closed'

/** The worker could not serve the replay; the reader should retry later. */
export class RunReplayUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'RunReplayUnavailableError'
  }
}

/**
 * Opens the worker's read-only replay of a run from its durable log, for a reader the
 * replay ring can no longer serve. No receipt is sent: the reader starts from an empty
 * response. Returns `null` when the worker knows no such run for this chat and user.
 */
export async function openRunReplay(params: {
  streamId: string
  chatId: string
  userId: string
  signal: AbortSignal
}): Promise<ReadableStream<Uint8Array> | null> {
  const { streamId, chatId, userId, signal } = params
  const baseUrl = await getMothershipBaseURL({ userId })
  let response: Response
  try {
    response = await fetchGo(`${baseUrl}${REPLAY_PATH}`, {
      method: 'POST',
      headers: mothershipRequestHeaders(),
      body: JSON.stringify(StreamReplayRequest.parse({ streamId, chatId, userId })),
      signal,
      spanName: `sim → go ${REPLAY_PATH}`,
      operation: 'stream_replay',
      attributes: { [TraceAttr.StreamId]: streamId, [TraceAttr.ChatId]: chatId },
    })
  } catch (error) {
    if (signal.aborted) throw error
    throw new RunReplayUnavailableError('The run replay could not be reached', { cause: error })
  }
  if (response.status === 404) {
    await response.body?.cancel().catch(() => {})
    return null
  }
  if (!response.ok || !response.body) {
    await response.body?.cancel().catch(() => {})
    throw new RunReplayUnavailableError(`The run replay failed with status ${response.status}`)
  }
  return response.body
}

function replayEndReason(value: unknown): StreamReplayEnd['reason'] | null {
  if (!isRecordLike(value) || value.type !== MothershipStreamV1EventType.run) return null
  const payload = value.payload
  if (!isRecordLike(payload) || payload.kind !== 'replay_end') return null
  return payload.reason === 'parked' || payload.reason === 'cap' || payload.reason === 'stalled'
    ? payload.reason
    : null
}

/**
 * Reads a replay leg, handing each stream event to `onEvent` in order. The leg's
 * `replay_end` frame is worker-to-Sim control and never reaches `onEvent`. Returning
 * false from `onEvent` stops the read (the reader went away).
 */
export async function readRunReplay(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  onEvent: (event: PersistedStreamEventEnvelope) => boolean
): Promise<RunReplayEnd> {
  let end: RunReplayEnd = 'closed'
  await processSSEStream(body.getReader(), signal, (raw) => {
    const reason = replayEndReason(raw)
    if (reason) {
      end = reason
      return true
    }
    const parsed = parsePersistedStreamEventEnvelope(raw)
    if (!parsed.ok) throw new FatalSseEventError(`Invalid run replay event: ${parsed.message}`)
    if (!onEvent(parsed.event)) return true
    if (parsed.event.type === MothershipStreamV1EventType.complete) {
      end = 'complete'
      return true
    }
    return undefined
  })
  return end
}
