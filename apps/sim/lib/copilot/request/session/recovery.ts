import { createLogger } from '@sim/logger'
import {
  MothershipStreamV1CompletionStatus,
  MothershipStreamV1EventType,
} from '@/lib/copilot/generated/mothership-stream-v1'
import { CopilotRecoveryOutcome } from '@/lib/copilot/generated/trace-attribute-values-v1'
import { TraceAttr } from '@/lib/copilot/generated/trace-attributes-v1'
import { TraceSpan } from '@/lib/copilot/generated/trace-spans-v1'
import { withCopilotSpan } from '@/lib/copilot/request/otel'
import { getLatestSeq, getOldestSeq, readEvents } from './buffer'
import { createEvent } from './event'

const logger = createLogger('SessionRecovery')

export interface ReplayGapResult {
  gapDetected: true
  envelopes: ReturnType<typeof createEvent>[]
}

export async function checkForReplayGap(
  streamId: string,
  afterCursor: string,
  requestId?: string
): Promise<ReplayGapResult | null> {
  const requestedAfterSeq = Number(afterCursor || '0')
  if (requestedAfterSeq <= 0) {
    // Fast path: no cursor → nothing to check. Skip the span to avoid
    // emitting zero-work spans on every stream connect.
    return null
  }

  return withCopilotSpan(
    TraceSpan.CopilotRecoveryCheckReplayGap,
    {
      [TraceAttr.StreamId]: streamId,
      [TraceAttr.CopilotRecoveryRequestedAfterSeq]: requestedAfterSeq,
      ...(requestId ? { [TraceAttr.RequestId]: requestId } : {}),
    },
    async (span) => {
      const oldestSeq = await getOldestSeq(streamId)
      const latestSeq = await getLatestSeq(streamId)
      span.setAttributes({
        [TraceAttr.CopilotRecoveryOldestSeq]: oldestSeq ?? -1,
        [TraceAttr.CopilotRecoveryLatestSeq]: latestSeq ?? -1,
      })

      if (
        latestSeq !== null &&
        latestSeq > 0 &&
        oldestSeq !== null &&
        requestedAfterSeq < oldestSeq - 1
      ) {
        const resolvedRequestId = await resolveReplayGapRequestId(streamId, latestSeq, requestId)
        logger.warn('Replay gap detected: requested cursor is below oldest available event', {
          streamId,
          requestedAfterSeq,
          oldestAvailableSeq: oldestSeq,
          latestSeq,
        })
        span.setAttribute(TraceAttr.CopilotRecoveryOutcome, CopilotRecoveryOutcome.GapDetected)

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

        return {
          gapDetected: true,
          envelopes: [gapEnvelope, terminalEnvelope],
        }
      }

      span.setAttribute(TraceAttr.CopilotRecoveryOutcome, CopilotRecoveryOutcome.InRange)
      return null
    }
  )
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
      error: error instanceof Error ? error.message : String(error),
    })
    return ''
  }
}
