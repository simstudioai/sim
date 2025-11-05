import { v4 as uuidv4 } from 'uuid'
import { db } from '@sim/db'
import { pausedExecutions } from '@sim/db/schema'
import type { PausePoint, SerializedSnapshot } from '@/executor/types'

interface PersistPauseResultArgs {
  workflowId: string
  executionId: string
  pausePoints: PausePoint[]
  snapshotSeed: SerializedSnapshot
}

export class PauseResumeManager {
  static async persistPauseResult(args: PersistPauseResultArgs): Promise<void> {
    const { workflowId, executionId, pausePoints, snapshotSeed } = args

    const pausePointsRecord = pausePoints.reduce<Record<string, any>>((acc, point) => {
      acc[point.contextId] = {
        contextId: point.contextId,
        triggerBlockId: point.triggerBlockId,
        response: point.response,
        resumeStatus: point.resumeStatus,
        snapshotReady: point.snapshotReady,
        registeredAt: point.registeredAt,
        parallelScope: point.parallelScope,
        loopScope: point.loopScope,
      }
      return acc
    }, {})

    const now = new Date()

    await db
      .insert(pausedExecutions)
      .values({
        id: uuidv4(),
        workflowId,
        executionId,
        executionSnapshot: snapshotSeed,
        pausePoints: pausePointsRecord,
        totalPauseCount: pausePoints.length,
        resumedCount: 0,
        status: 'paused',
        metadata: {
          pauseScope: 'execution',
          triggerIds: snapshotSeed.triggerIds,
        },
        pausedAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: pausedExecutions.executionId,
        set: {
          executionSnapshot: snapshotSeed,
          pausePoints: pausePointsRecord,
          totalPauseCount: pausePoints.length,
          resumedCount: 0,
          status: 'paused',
          metadata: {
            pauseScope: 'execution',
            triggerIds: snapshotSeed.triggerIds,
          },
          updatedAt: now,
        },
      })
  }
}


