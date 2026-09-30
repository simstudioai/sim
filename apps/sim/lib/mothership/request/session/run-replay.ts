import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { isRecordLike, toRecord } from '@sim/utils/object'
import { z } from 'zod'
import { WORKER_STREAM_IDLE_TIMEOUT_MS } from '@/lib/mothership/constants'
import { MothershipStreamV1EventType } from '@/lib/mothership/generated/mothership-stream-v1'
import { type StreamReplayEnd, StreamReplayRequest } from '@/lib/mothership/generated/protocol'
import { TraceAttr } from '@/lib/mothership/generated/trace-attributes-v1'
import { fetchGo } from '@/lib/mothership/request/go/fetch'
import { FatalSseEventError, processSSEStream } from '@/lib/mothership/request/go/parser'
import { mothershipRequestHeaders } from '@/lib/mothership/request/headers'
import {
  isTerminalStreamStatus,
  type PersistedStreamEventEnvelope,
  parsePersistedStreamEventEnvelope,
} from '@/lib/mothership/request/session/contract'
import { toReplayEnvelope } from '@/lib/mothership/request/session/types'
import { getMothershipBaseURL } from '@/lib/mothership/server/agent-url'

const logger = createLogger('RunReplay')

const REPLAY_PATH = '/api/streams/replay'
/** Answers that no retry changes, so the reader falls back to `replay_gap`. */
const REPLAY_REFUSED_STATUSES: ReadonlySet<number> = new Set([401, 403, 404])
/** A reader's replay response stays open at least this long unless the run ended. */
const REPLAY_MIN_RESPONSE_MS = 10_000
const REPLAY_HOLD_POLL_MS = 1_000
const PARKED_RUN_STATUS = 'paused_waiting_for_tool'

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
 * response. Returns `null` when the worker will not replay it: it knows no such run for
 * this chat and user, or this deployment's key may not call the replay at all.
 */
export async function openRunReplay(params: {
  streamId: string
  chatId: string
  userId: string
  signal: AbortSignal
}): Promise<ReadableStream<Uint8Array> | null> {
  const { streamId, chatId, userId, signal } = params
  const baseUrl = await getMothershipBaseURL({ userId })
  const unanswered = new AbortController()
  const headersTimer = setTimeout(
    () => unanswered.abort(new Error('The worker did not answer the replay request')),
    WORKER_STREAM_IDLE_TIMEOUT_MS
  )
  let response: Response
  try {
    response = await fetchGo(`${baseUrl}${REPLAY_PATH}`, {
      method: 'POST',
      headers: mothershipRequestHeaders(),
      body: JSON.stringify(StreamReplayRequest.parse({ streamId, chatId, userId })),
      signal: AbortSignal.any([signal, unanswered.signal]),
      spanName: `sim → go ${REPLAY_PATH}`,
      operation: 'stream_replay',
      attributes: { [TraceAttr.StreamId]: streamId, [TraceAttr.ChatId]: chatId },
    })
  } catch (error) {
    if (signal.aborted) throw error
    throw new RunReplayUnavailableError('The run replay could not be reached', { cause: error })
  } finally {
    clearTimeout(headersTimer)
  }
  if (REPLAY_REFUSED_STATUSES.has(response.status)) {
    // A key refusal is otherwise silent: every reader just falls back to replay_gap.
    if (response.status !== 404) {
      logger.warn('The worker refused this deployment the run replay', {
        streamId,
        status: response.status,
      })
    }
    await response.body?.cancel().catch(() => {})
    return null
  }
  if (!response.ok || !response.body) {
    await response.body?.cancel().catch(() => {})
    throw new RunReplayUnavailableError(`The run replay failed with status ${response.status}`)
  }
  return response.body
}

/** Every reason the worker may end a replay with; a reason added to the contract fails here. */
const REPLAY_END_REASONS = {
  parked: true,
  cap: true,
  stalled: true,
} as const satisfies Record<StreamReplayEnd['reason'], true>

const StreamReplayEndSchema = z.object({
  kind: z.literal('replay_end'),
  reason: z
    .string()
    .refine((reason): reason is StreamReplayEnd['reason'] =>
      Object.hasOwn(REPLAY_END_REASONS, reason)
    ),
  textLength: z.number().int().nonnegative(),
}) satisfies z.ZodType<StreamReplayEnd>

/**
 * The end a `replay_end` frame reports: its reason, `closed` for a reason this build
 * does not know, or `null` for any other frame. It is worker-to-Sim control, never a
 * stream event, whatever reason it carries.
 */
function replayEnd(value: unknown): RunReplayEnd | null {
  if (!isRecordLike(value) || value.type !== MothershipStreamV1EventType.run) return null
  const payload = toRecord(value.payload)
  if (payload.kind !== 'replay_end') return null
  const parsed = StreamReplayEndSchema.safeParse(payload)
  if (parsed.success) return parsed.data.reason
  logger.warn('Run replay ended with an unknown reason', { reason: payload.reason })
  return 'closed'
}

/**
 * Reads a replay leg, handing each stream event to `onEvent` in order. The leg's
 * `replay_end` frame never reaches `onEvent`. Returning false from `onEvent` stops the
 * read (the reader went away).
 */
async function readRunReplay(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  onEvent: (event: PersistedStreamEventEnvelope) => boolean
): Promise<RunReplayEnd> {
  let end: RunReplayEnd = 'closed'
  await processSSEStream(
    body.getReader(),
    signal,
    (raw) => {
      const control = replayEnd(raw)
      if (control) {
        end = control
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
    },
    WORKER_STREAM_IDLE_TIMEOUT_MS
  )
  return end
}

export interface ForwardRunReplayOptions {
  body: ReadableStream<Uint8Array>
  streamId: string
  signal: AbortSignal
  /** Writes one event to the reader; false once the reader is gone. */
  write: (event: PersistedStreamEventEnvelope) => boolean
  /** The run's current status, or null when it cannot be read. */
  readRunStatus: () => Promise<string | null>
  isClosed: () => boolean
  /** When the reader's response must end regardless. */
  deadlineAt: number
}

/**
 * Forwards a replay leg to one reader under that response's own cursors, starting at
 * 1, then decides how long the response stays open. A terminal or the worker's cap
 * ends it at once: the cap came after minutes of progress. Otherwise it holds, ending
 * as soon as the run reaches a terminal or, after a park, resumes; a stall or a cut
 * connection holds at least {@link REPLAY_MIN_RESPONSE_MS}, so a reader re-attaches,
 * and replays the whole log again, at most that often.
 */
export async function forwardRunReplay(options: ForwardRunReplayOptions): Promise<RunReplayEnd> {
  const { body, streamId, signal, write, readRunStatus, isClosed, deadlineAt } = options
  const startedAt = Date.now()
  let seq = 0
  const end = await readRunReplay(body, signal, (event) => {
    seq += 1
    return write(
      toReplayEnvelope({
        ...event,
        seq,
        stream: { ...event.stream, streamId, cursor: String(seq) },
      })
    )
  }).catch((error: unknown) => {
    if (error instanceof FatalSseEventError) throw error
    logger.warn('Run replay connection ended early', { streamId, error: getErrorMessage(error) })
    return 'closed' as const
  })
  if (end === 'complete' || end === 'cap') return end
  // Sim may mark the park a moment after the worker ends on it, so a park only counts as
  // resumed once Sim was seen parked; until then it holds like any other end.
  let sawParked = false
  while (!isClosed() && Date.now() < deadlineAt) {
    const status = await readRunStatus()
    if (isTerminalStreamStatus(status)) break
    const parked = end === 'parked' && status === PARKED_RUN_STATUS
    if (end === 'parked' && sawParked && !parked) break
    sawParked ||= parked
    const remaining = REPLAY_MIN_RESPONSE_MS - (Date.now() - startedAt)
    if (!parked && remaining <= 0) break
    await sleep(parked ? REPLAY_HOLD_POLL_MS : Math.min(REPLAY_HOLD_POLL_MS, remaining))
  }
  return end
}
