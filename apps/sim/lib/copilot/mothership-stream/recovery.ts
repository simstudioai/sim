import { createLogger } from '@sim/logger'
import {
  MothershipStreamV1CompletionStatus,
  MothershipStreamV1EventType,
} from '@/lib/copilot/generated/mothership-stream-v1'
import { createEnvelope } from './envelope'
import { getLatestSeq, getOldestSeq } from './outbox'

const logger = createLogger('MothershipStreamRecovery')

export interface ReplayGapResult {
  gapDetected: true
  envelopes: ReturnType<typeof createEnvelope>[]
}

export async function checkForReplayGap(
  streamId: string,
  afterCursor: string
): Promise<ReplayGapResult | null> {
  const requestedAfterSeq = Number(afterCursor || '0')
  if (requestedAfterSeq <= 0) {
    return null
  }

  const oldestSeq = await getOldestSeq(streamId)
  const latestSeq = await getLatestSeq(streamId)

  if (
    latestSeq !== null &&
    latestSeq > 0 &&
    oldestSeq !== null &&
    requestedAfterSeq < oldestSeq - 1
  ) {
    logger.warn('Replay gap detected: requested cursor is below oldest available event', {
      streamId,
      requestedAfterSeq,
      oldestAvailableSeq: oldestSeq,
      latestSeq,
    })

    const gapEnvelope = createEnvelope({
      streamId,
      cursor: String(latestSeq + 1),
      seq: latestSeq + 1,
      requestId: '',
      type: MothershipStreamV1EventType.error,
      payload: {
        message: 'Replay history is no longer available. Some events may have been lost.',
        code: 'replay_gap',
        oldestAvailableSeq: oldestSeq,
        requestedAfterSeq,
      },
    })

    const terminalEnvelope = createEnvelope({
      streamId,
      cursor: String(latestSeq + 2),
      seq: latestSeq + 2,
      requestId: '',
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

  return null
}
