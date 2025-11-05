import { v4 as uuidv4 } from 'uuid'
import { sql, eq, and, inArray, lt } from 'drizzle-orm'
import { db } from '@sim/db'
import { pausedExecutions, resumeQueue } from '@sim/db/schema'
import type { PausePoint, SerializedSnapshot } from '@/executor/types'
import { ExecutionSnapshot } from '@/executor/execution/snapshot'
import { LoggingSession } from '@/lib/logs/execution/logging-session'
import { executeWorkflowCore } from './execution-core'

interface PersistPauseResultArgs {
  workflowId: string
  executionId: string
  pausePoints: PausePoint[]
  snapshotSeed: SerializedSnapshot
}

interface EnqueueResumeArgs {
  executionId: string
  contextId: string
  resumeInput: any
  userId: string
}

type EnqueueResumeResult =
  | {
      status: 'queued'
      resumeExecutionId: string
      queuePosition: number
    }
  | {
      status: 'starting'
      resumeExecutionId: string
      resumeEntryId: string
      pausedExecution: typeof pausedExecutions.$inferSelect
      contextId: string
      resumeInput: any
      userId: string
    }

interface StartResumeExecutionArgs {
  resumeEntryId: string
  resumeExecutionId: string
  pausedExecution: typeof pausedExecutions.$inferSelect
  contextId: string
  resumeInput: any
  userId: string
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

    await this.processQueuedResumes(executionId)
  }

  static async enqueueOrStartResume(args: EnqueueResumeArgs): Promise<EnqueueResumeResult> {
    const { executionId, contextId, resumeInput, userId } = args

    return await db.transaction(async (tx) => {
      const pausedExecution = await tx
        .select()
        .from(pausedExecutions)
        .where(eq(pausedExecutions.executionId, executionId))
        .limit(1)
        .then((rows) => rows[0])

      if (!pausedExecution) {
        throw new Error('Paused execution not found or already resumed')
      }

      const pausePoints = pausedExecution.pausePoints as Record<string, any>
      const pausePoint = pausePoints?.[contextId]
      if (!pausePoint) {
        throw new Error('Pause point not found for execution')
      }
      if (pausePoint.resumeStatus !== 'paused') {
        throw new Error('Pause point already resumed')
      }

      const activeResume = await tx
        .select({ id: resumeQueue.id })
        .from(resumeQueue)
        .where(
          and(
            eq(resumeQueue.parentExecutionId, executionId),
            inArray(resumeQueue.status, ['claimed'] as const)
          )
        )
        .limit(1)
        .then((rows) => rows[0])

      const resumeExecutionId = uuidv4()
      const now = new Date()

      if (activeResume) {
        const [entry] = await tx
          .insert(resumeQueue)
          .values({
            id: uuidv4(),
            pausedExecutionId: pausedExecution.id,
            parentExecutionId: executionId,
            newExecutionId: resumeExecutionId,
            contextId,
            resumeInput: resumeInput ?? null,
            status: 'pending',
            queuedAt: now,
          })
          .returning({ id: resumeQueue.id, queuedAt: resumeQueue.queuedAt })

        const [{ position }] = await tx
          .select({ position: sql<number>`count(*)` })
          .from(resumeQueue)
          .where(
            and(
              eq(resumeQueue.parentExecutionId, executionId),
              eq(resumeQueue.status, 'pending'),
              lt(resumeQueue.queuedAt, entry.queuedAt)
            )
          )

        return {
          status: 'queued',
          resumeExecutionId,
          queuePosition: Number(position) + 1,
        }
      }

      const resumeEntryId = uuidv4()
      await tx.insert(resumeQueue).values({
        id: resumeEntryId,
        pausedExecutionId: pausedExecution.id,
        parentExecutionId: executionId,
        newExecutionId: resumeExecutionId,
        contextId,
        resumeInput: resumeInput ?? null,
        status: 'claimed',
        queuedAt: now,
        claimedAt: now,
      })

      return {
        status: 'starting',
        resumeExecutionId,
        resumeEntryId,
        pausedExecution,
        contextId,
        resumeInput,
        userId,
      }
    })
  }

  static async startResumeExecution(args: StartResumeExecutionArgs): Promise<void> {
    const { resumeEntryId, resumeExecutionId, pausedExecution, contextId, resumeInput, userId } =
      args

    try {
      await this.runResumeExecution({
        resumeExecutionId,
        pausedExecution,
        contextId,
        resumeInput,
        userId,
      })

      await this.markResumeCompleted({
        resumeEntryId,
        pausedExecutionId: pausedExecution.id,
        parentExecutionId: pausedExecution.executionId,
        contextId,
      })

      await this.processQueuedResumes(pausedExecution.executionId)
    } catch (error) {
      await this.markResumeFailed({ resumeEntryId, failureReason: (error as Error).message })
      throw error
    }
  }

  private static async runResumeExecution(args: {
    resumeExecutionId: string
    pausedExecution: typeof pausedExecutions.$inferSelect
    contextId: string
    resumeInput: any
    userId: string
  }): Promise<void> {
    const { resumeExecutionId, pausedExecution, contextId, resumeInput, userId } = args

    const serializedSnapshot = pausedExecution.executionSnapshot as SerializedSnapshot
    const baseSnapshot = ExecutionSnapshot.fromJSON(serializedSnapshot.snapshot)
    const pausePoints = pausedExecution.pausePoints as Record<string, any>
    const pausePoint = pausePoints?.[contextId]
    if (!pausePoint) {
      throw new Error('Pause point not found for resume execution')
    }

    const triggerBlockId: string = pausePoint.triggerBlockId

    const stateCopy = baseSnapshot.state
      ? {
          ...baseSnapshot.state,
          blockStates: { ...baseSnapshot.state.blockStates },
        }
      : undefined

    if (stateCopy) {
      stateCopy.pendingQueue = [triggerBlockId]
      const triggerState = stateCopy.blockStates[triggerBlockId] ?? {
        output: {},
        executed: true,
        executionTime: 0,
      }
      triggerState.output = {
        ...triggerState.output,
        input: resumeInput ?? {},
        resumedFrom: pausedExecution.executionId,
      }
      triggerState.executed = true
      triggerState.executionTime = 0
      stateCopy.blockStates[triggerBlockId] = triggerState
    }

    const metadata = {
      ...baseSnapshot.metadata,
      executionId: resumeExecutionId,
      requestId: resumeExecutionId.slice(0, 8),
      triggerBlockId,
      startTime: new Date().toISOString(),
      userId,
    }

    const resumeSnapshot = new ExecutionSnapshot(
      metadata,
      baseSnapshot.workflow,
      resumeInput ?? {},
      {},
      baseSnapshot.workflowVariables || {},
      baseSnapshot.selectedOutputs || [],
      stateCopy
    )

    const triggerType = (metadata.triggerType as
      | 'api'
      | 'webhook'
      | 'schedule'
      | 'manual'
      | 'chat'
      | undefined) ?? 'manual'
    const loggingSession = new LoggingSession(
      metadata.workflowId,
      resumeExecutionId,
      triggerType,
      metadata.requestId
    )

    await executeWorkflowCore({
      snapshot: resumeSnapshot,
      callbacks: {},
      loggingSession,
    })
  }

  private static async markResumeCompleted(args: {
    resumeEntryId: string
    pausedExecutionId: string
    parentExecutionId: string
    contextId: string
  }): Promise<void> {
    const { resumeEntryId, pausedExecutionId, parentExecutionId, contextId } = args
    const now = new Date()

    await db.transaction(async (tx) => {
      await tx
        .update(resumeQueue)
        .set({ status: 'completed', completedAt: now, failureReason: null })
        .where(eq(resumeQueue.id, resumeEntryId))

      await tx
        .update(pausedExecutions)
        .set({
          pausePoints: sql`jsonb_set(jsonb_set(pause_points, ARRAY[${contextId}, 'resumeStatus'], '"resumed"'::jsonb), ARRAY[${contextId}, 'resumedAt'], to_jsonb(${now.toISOString()}))`,
          resumedCount: sql`resumed_count + 1`,
          status: sql`CASE WHEN resumed_count + 1 >= total_pause_count THEN 'fully_resumed' ELSE 'partially_resumed' END`,
          updatedAt: now,
        })
        .where(eq(pausedExecutions.id, pausedExecutionId))

      const [{ remaining }] = await tx
        .select({ remaining: sql<number>`total_pause_count - resumed_count - 1` })
        .from(pausedExecutions)
        .where(eq(pausedExecutions.executionId, parentExecutionId))

      if (Number(remaining) <= 0) {
        await tx
          .update(pausedExecutions)
          .set({ status: 'fully_resumed', updatedAt: now })
          .where(eq(pausedExecutions.executionId, parentExecutionId))
      }
    })
  }

  private static async markResumeFailed(args: {
    resumeEntryId: string
    failureReason: string
  }): Promise<void> {
    await db
      .update(resumeQueue)
      .set({ status: 'failed', failureReason: args.failureReason, completedAt: new Date() })
      .where(eq(resumeQueue.id, args.resumeEntryId))
  }

  static async processQueuedResumes(parentExecutionId: string): Promise<void> {
    const pendingEntry = await db.transaction(async (tx) => {
      const entry = await tx
        .select()
        .from(resumeQueue)
        .where(and(eq(resumeQueue.parentExecutionId, parentExecutionId), eq(resumeQueue.status, 'pending')))
        .orderBy(resumeQueue.queuedAt)
        .limit(1)
        .then((rows) => rows[0])

      if (!entry) {
        return null
      }

      await tx
        .update(resumeQueue)
        .set({ status: 'claimed', claimedAt: new Date() })
        .where(eq(resumeQueue.id, entry.id))

      const pausedExecution = await tx
        .select()
        .from(pausedExecutions)
        .where(eq(pausedExecutions.id, entry.pausedExecutionId))
        .limit(1)
        .then((rows) => rows[0])

      if (!pausedExecution) {
        return null
      }

      return { entry, pausedExecution }
    })

    if (!pendingEntry) {
      return
    }

    const { entry, pausedExecution } = pendingEntry

    void this.startResumeExecution({
      resumeEntryId: entry.id,
      resumeExecutionId: entry.newExecutionId,
      pausedExecution,
      contextId: entry.contextId,
      resumeInput: entry.resumeInput,
      userId: '',
    })
  }
}

