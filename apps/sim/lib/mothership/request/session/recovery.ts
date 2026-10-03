import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import {
  MothershipStreamV1CompletionStatus,
  MothershipStreamV1EventType,
} from '@/lib/mothership/generated/mothership-stream-v1'
import { CopilotRecoveryOutcome } from '@/lib/mothership/generated/trace-attribute-values-v1'
import { TraceAttr } from '@/lib/mothership/generated/trace-attributes-v1'
import { TraceSpan } from '@/lib/mothership/generated/trace-spans-v1'
import { withCopilotSpan } from '@/lib/mothership/request/otel'
import { getLatestSeq, getOldestSeq, readEvents } from './buffer'
import { createEvent } from './event'

const logger = createLogger('SessionRecovery')

export interface ReplayGapResult {
  gapDetected: true
  envelopes: ReturnType<typeof createEvent>[]
}

/** Where the replay ring stands relative to a reader's cursor; 0 marks an empty ring. */
export interface RingPosition {
  requestedAfterSeq: number
  oldestSeq: number
  latestSeq: number
}

/**
 * Whether a ring whose first retained event has `firstSeq` still holds the stream's
 * first event. The ring trims its oldest events, so a read from cursor 0 can start
 * mid-stream; anything that rebuilds a turn from such a read must not, and a reader
 * of it is re-synced from the worker's log instead ({@link findReplayGap}).
 */
export function startsAtReplayHead(firstSeq: number | undefined): boolean {
  return firstSeq === undefined || firstSeq <= 1
}

export async function readRingPosition(
  streamId: string,
  afterCursor: string
): Promise<RingPosition> {
  const [oldestSeq, latestSeq] = await Promise.all([getOldestSeq(streamId), getLatestSeq(streamId)])
  return {
    requestedAfterSeq: Number(afterCursor || '0'),
    oldestSeq: oldestSeq ?? 0,
    latestSeq: latestSeq ?? 0,
  }
}

/**
 * Whether the ring can serve a reader from its cursor. It cannot once it has lost its
 * head: the events before its oldest are gone, and a cursor that was served from the
 * worker's log instead is not a position in the ring, so no cursor is trusted. Nor can
 * it serve a cursor ahead of its latest event, which only a buffer whose numbering
 * restarted after it expired produces, nor any cursor from a buffer that expired.
 */
export function ringCanServe({ requestedAfterSeq, oldestSeq, latestSeq }: RingPosition): boolean {
  if (latestSeq <= 0) return requestedAfterSeq <= 0
  return startsAtReplayHead(oldestSeq) && requestedAfterSeq <= latestSeq
}

/** The ring's position when it cannot serve `afterCursor` (see {@link ringCanServe}). */
export async function findReplayGap(
  streamId: string,
  afterCursor: string,
  requestId?: string
): Promise<RingPosition | null> {
  return withCopilotSpan(
    TraceSpan.CopilotRecoveryCheckReplayGap,
    {
      [TraceAttr.StreamId]: streamId,
      [TraceAttr.CopilotRecoveryRequestedAfterSeq]: Number(afterCursor || '0'),
      ...(requestId ? { [TraceAttr.RequestId]: requestId } : {}),
    },
    async (span) => {
      const position = await readRingPosition(streamId, afterCursor)
      span.setAttributes({
        [TraceAttr.CopilotRecoveryOldestSeq]: position.oldestSeq,
        [TraceAttr.CopilotRecoveryLatestSeq]: position.latestSeq,
      })
      if (ringCanServe(position)) {
        span.setAttribute(TraceAttr.CopilotRecoveryOutcome, CopilotRecoveryOutcome.InRange)
        return null
      }
      logger.warn('Replay gap detected: the ring cannot serve the requested cursor', {
        streamId,
        ...position,
      })
      span.setAttribute(TraceAttr.CopilotRecoveryOutcome, CopilotRecoveryOutcome.GapDetected)
      return position
    }
  )
}

/**
 * Ends a reader's view with `replay_gap` when nothing can re-sync it, numbered past
 * both the ring and the reader's cursor so the reader cannot drop it as already seen.
 */
export async function replayGapTerminal(
  streamId: string,
  position: RingPosition,
  requestId?: string
): Promise<ReplayGapResult> {
  const { latestSeq, oldestSeq, requestedAfterSeq } = position
  const baseSeq = Math.max(latestSeq, requestedAfterSeq)
  const resolvedRequestId = await resolveReplayGapRequestId(streamId, latestSeq, requestId)
  const gapEnvelope = createEvent({
    streamId,
    cursor: String(baseSeq + 1),
    seq: baseSeq + 1,
    requestId: resolvedRequestId,
    type: MothershipStreamV1EventType.error,
    payload: {
      message: 'Replay history is no longer available. Some events may have been lost.',
      code: 'replay_gap',
      data: {
        oldestAvailableSeq: oldestSeq,
        requestedAfterSeq,
      },
    },
  })
  const terminalEnvelope = createEvent({
    streamId,
    cursor: String(baseSeq + 2),
    seq: baseSeq + 2,
    requestId: resolvedRequestId,
    type: MothershipStreamV1EventType.complete,
    payload: {
      status: MothershipStreamV1CompletionStatus.error,
      reason: 'replay_gap',
    },
  })
  return { gapDetected: true, envelopes: [gapEnvelope, terminalEnvelope] }
}

async function resolveReplayGapRequestId(
  streamId: string,
  latestSeq: number,
  requestId?: string
): Promise<string> {
  if (typeof requestId === 'string' && requestId.length > 0) {
    return requestId
  }

  try {
    const latestEvents = await readEvents(streamId, String(Math.max(latestSeq - 1, 0)))
    const latestRequestId = latestEvents[0]?.trace?.requestId
    return typeof latestRequestId === 'string' ? latestRequestId : ''
  } catch (error) {
    logger.warn('Failed to resolve request ID for replay gap', {
      streamId,
      latestSeq,
      error: getErrorMessage(error),
    })
    return ''
  }
}
