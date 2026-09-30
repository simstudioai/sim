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

/** Where the replay ring stands relative to a reader it can no longer serve. */
export interface ReplayGap {
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

/**
 * Whether the ring can serve a reader from `afterCursor`. It cannot once it has lost
 * its head: the events before its oldest are gone, and a cursor that was served from
 * the worker's log instead is not a position in the ring, so no cursor is trusted. Nor
 * can it serve a cursor ahead of its latest event, which only a buffer whose numbering
 * restarted after it expired produces.
 */
export async function findReplayGap(
  streamId: string,
  afterCursor: string,
  requestId?: string
): Promise<ReplayGap | null> {
  const requestedAfterSeq = Number(afterCursor || '0')
  return withCopilotSpan(
    TraceSpan.CopilotRecoveryCheckReplayGap,
    {
      [TraceAttr.StreamId]: streamId,
      [TraceAttr.CopilotRecoveryRequestedAfterSeq]: requestedAfterSeq,
      ...(requestId ? { [TraceAttr.RequestId]: requestId } : {}),
    },
    async (span) => {
      const [oldestSeq, latestSeq] = await Promise.all([
        getOldestSeq(streamId),
        getLatestSeq(streamId),
      ])
      span.setAttributes({
        [TraceAttr.CopilotRecoveryOldestSeq]: oldestSeq ?? -1,
        [TraceAttr.CopilotRecoveryLatestSeq]: latestSeq ?? -1,
      })
      if (
        latestSeq === null ||
        latestSeq <= 0 ||
        oldestSeq === null ||
        (startsAtReplayHead(oldestSeq) && requestedAfterSeq <= latestSeq)
      ) {
        span.setAttribute(TraceAttr.CopilotRecoveryOutcome, CopilotRecoveryOutcome.InRange)
        return null
      }
      logger.warn('Replay gap detected: the ring cannot serve the requested cursor', {
        streamId,
        requestedAfterSeq,
        oldestAvailableSeq: oldestSeq,
        latestSeq,
      })
      span.setAttribute(TraceAttr.CopilotRecoveryOutcome, CopilotRecoveryOutcome.GapDetected)
      return { requestedAfterSeq, oldestSeq, latestSeq }
    }
  )
}

/** Ends a reader's view with `replay_gap` when nothing can re-sync it. */
export async function replayGapTerminal(
  streamId: string,
  gap: ReplayGap,
  requestId?: string
): Promise<ReplayGapResult> {
  const { latestSeq, oldestSeq, requestedAfterSeq } = gap
  const resolvedRequestId = await resolveReplayGapRequestId(streamId, latestSeq, requestId)
  const gapEnvelope = createEvent({
    streamId,
    cursor: String(latestSeq + 1),
    seq: latestSeq + 1,
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
    cursor: String(latestSeq + 2),
    seq: latestSeq + 2,
    requestId: resolvedRequestId,
    type: MothershipStreamV1EventType.complete,
    payload: {
      status: MothershipStreamV1CompletionStatus.error,
      reason: 'replay_gap',
    },
  })
  return { gapDetected: true, envelopes: [gapEnvelope, terminalEnvelope] }
}

export async function checkForReplayGap(
  streamId: string,
  afterCursor: string,
  requestId?: string
): Promise<ReplayGapResult | null> {
  const gap = await findReplayGap(streamId, afterCursor, requestId)
  return gap ? replayGapTerminal(streamId, gap, requestId) : null
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
