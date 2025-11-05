import { v4 as uuidv4 } from 'uuid'
import { sql, eq, and, inArray, lt, asc, desc } from 'drizzle-orm'
import { db } from '@sim/db'
import { pausedExecutions, resumeQueue } from '@sim/db/schema'
import type { ExecutionResult, PausePoint, SerializedSnapshot } from '@/executor/types'
import { ExecutionSnapshot } from '@/executor/execution/snapshot'
import { LoggingSession } from '@/lib/logs/execution/logging-session'
import { createLogger } from '@/lib/logs/console/logger'
import { executeWorkflowCore } from './execution-core'

const logger = createLogger('PauseResumeManager')

interface ResumeQueueEntrySummary {
  id: string
  pausedExecutionId: string
  parentExecutionId: string
  newExecutionId: string
  contextId: string
  resumeInput: any
  status: string
  queuedAt: string | null
  claimedAt: string | null
  completedAt: string | null
  failureReason: string | null
}

interface PausePointWithQueue extends PausePoint {
  queuePosition?: number | null
  latestResumeEntry?: ResumeQueueEntrySummary | null
}

interface PausedExecutionSummary {
  id: string
  workflowId: string
  executionId: string
  status: string
  totalPauseCount: number
  resumedCount: number
  pausedAt: string | null
  updatedAt: string | null
  expiresAt: string | null
  metadata: Record<string, any> | null
  triggerIds: string[]
  pausePoints: PausePointWithQueue[]
}

interface PausedExecutionDetail extends PausedExecutionSummary {
  executionSnapshot: SerializedSnapshot
  queue: ResumeQueueEntrySummary[]
}

interface PauseContextDetail {
  execution: PausedExecutionSummary
  pausePoint: PausePointWithQueue
  queue: ResumeQueueEntrySummary[]
  activeResumeEntry?: ResumeQueueEntrySummary | null
}

interface PersistPauseResultArgs {
  workflowId: string
  executionId: string
  pausePoints: PausePoint[]
  snapshotSeed: SerializedSnapshot
  executorUserId?: string
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
    const { workflowId, executionId, pausePoints, snapshotSeed, executorUserId } = args

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
        resumeLinks: point.resumeLinks,
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
          executorUserId: executorUserId ?? null,
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
            executorUserId: executorUserId ?? null,
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
      if (!pausePoint.snapshotReady) {
        throw new Error('Snapshot not ready; execution still finalizing pause')
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

        const [positionRow = { position: 0 }] = await tx
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
          queuePosition: Number(positionRow.position ?? 0) + 1,
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
      const result = await this.runResumeExecution({
        resumeExecutionId,
        pausedExecution,
        contextId,
        resumeInput,
        userId,
      })

      if (result.status === 'paused') {
        if (!result.snapshotSeed) {
          logger.error('Missing snapshot seed for paused resume execution', {
            resumeExecutionId,
          })
        } else {
          await this.persistPauseResult({
            workflowId: pausedExecution.workflowId,
            executionId: result.metadata?.executionId ?? resumeExecutionId,
            pausePoints: result.pausePoints || [],
            snapshotSeed: result.snapshotSeed,
            executorUserId: result.metadata?.userId,
          })
        }
      }

      await this.markResumeCompleted({
        resumeEntryId,
        pausedExecutionId: pausedExecution.id,
        parentExecutionId: pausedExecution.executionId,
        contextId,
      })

      await this.processQueuedResumes(pausedExecution.executionId)
    } catch (error) {
      await this.markResumeFailed({ resumeEntryId, failureReason: (error as Error).message })
      logger.error('Resume execution failed', {
        parentExecutionId: pausedExecution.executionId,
        resumeExecutionId,
        contextId,
        error,
      })
      await this.processQueuedResumes(pausedExecution.executionId)
      throw error
    }
  }

  private static async runResumeExecution(args: {
    resumeExecutionId: string
    pausedExecution: typeof pausedExecutions.$inferSelect
    contextId: string
    resumeInput: any
    userId: string
  }): Promise<ExecutionResult> {
    const { resumeExecutionId, pausedExecution, contextId, resumeInput, userId } = args

    logger.info('Starting resume execution', {
      resumeExecutionId,
      parentExecutionId: pausedExecution.executionId,
      contextId,
      hasResumeInput: !!resumeInput,
    })

    const serializedSnapshot = pausedExecution.executionSnapshot as SerializedSnapshot
    const baseSnapshot = ExecutionSnapshot.fromJSON(serializedSnapshot.snapshot)
    
    logger.info('Loaded snapshot from paused execution', {
      workflowId: baseSnapshot.workflow?.version,
      workflowBlockCount: baseSnapshot.workflow?.blocks?.length,
      hasState: !!baseSnapshot.state,
      snapshotMetadata: baseSnapshot.metadata,
    })

    const pausePoints = pausedExecution.pausePoints as Record<string, any>
    const pausePoint = pausePoints?.[contextId]
    if (!pausePoint) {
      throw new Error('Pause point not found for resume execution')
    }

    const triggerBlockId: string = pausePoint.triggerBlockId
    
    logger.info('Resume trigger identified', {
      triggerBlockId,
      contextId,
      pausePointKeys: Object.keys(pausePoints),
    })

    // Find the blocks downstream of the pause block
    const pauseBlockId = contextId // The pause block's ID is the contextId
    const downstreamBlocks = baseSnapshot.workflow.connections
      .filter((conn: any) => conn.source === pauseBlockId)
      .map((conn: any) => conn.target)
    
    logger.info('Found downstream blocks', {
      pauseBlockId,
      downstreamBlocks,
    })

    const stateCopy = baseSnapshot.state
      ? {
          ...baseSnapshot.state,
          blockStates: { ...baseSnapshot.state.blockStates },
        }
      : undefined

    logger.info('Preparing resume state', {
      hasStateCopy: !!stateCopy,
      existingBlockStatesCount: stateCopy ? Object.keys(stateCopy.blockStates).length : 0,
      executedBlocksCount: stateCopy?.executedBlocks?.length ?? 0,
    })

    if (stateCopy) {
      // Set the pause block as completed with the resume input
      const pauseBlockState = stateCopy.blockStates[pauseBlockId] ?? {
        output: {},
        executed: true,
        executionTime: 0,
      }
      pauseBlockState.output = {
        response: {
          data: resumeInput ?? {},
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
        _resumed: true,
        _resumedFrom: pausedExecution.executionId,
      }
      pauseBlockState.executed = true
      stateCopy.blockStates[pauseBlockId] = pauseBlockState
      
      // Queue the downstream blocks for execution
      stateCopy.pendingQueue = downstreamBlocks.length > 0 ? downstreamBlocks : []
      
      logger.info('Updated pause block state for resume', {
        pauseBlockId,
        pendingQueue: stateCopy.pendingQueue,
        pauseBlockOutput: pauseBlockState.output,
      })
    }

    const metadata = {
      ...baseSnapshot.metadata,
      executionId: resumeExecutionId,
      requestId: resumeExecutionId.slice(0, 8),
      triggerBlockId: undefined, // No trigger needed for resume
      startTime: new Date().toISOString(),
      userId,
      useDraftState: baseSnapshot.metadata.useDraftState,
      resumeFromSnapshot: true,
    }

    const resumeSnapshot = new ExecutionSnapshot(
      metadata,
      baseSnapshot.workflow,
      resumeInput ?? {},
      baseSnapshot.environmentVariables || {},
      baseSnapshot.workflowVariables || {},
      baseSnapshot.selectedOutputs || [],
      stateCopy
    )

    logger.info('Created resume snapshot', {
      metadata,
      hasWorkflow: !!baseSnapshot.workflow,
      hasState: !!stateCopy,
      pendingQueue: stateCopy?.pendingQueue,
    })

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

    logger.info('Invoking executeWorkflowCore for resume', {
      resumeExecutionId,
      triggerType,
      useDraftState: metadata.useDraftState,
      resumeFromSnapshot: metadata.resumeFromSnapshot,
    })

    return await executeWorkflowCore({
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
          pausePoints: sql`jsonb_set(jsonb_set(pause_points, ARRAY[${contextId}, 'resumeStatus'], '"resumed"'::jsonb), ARRAY[${contextId}, 'resumedAt'], '"${sql.raw(now.toISOString())}"'::jsonb)`,
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

  static async listPausedExecutions(options: {
    workflowId: string
    status?: string | string[]
  }): Promise<PausedExecutionSummary[]> {
    const { workflowId, status } = options

    let whereClause: any = eq(pausedExecutions.workflowId, workflowId)

    if (status) {
      const statuses = Array.isArray(status) ? status : String(status).split(',').map((s) => s.trim())
      if (statuses.length === 1) {
        whereClause = and(whereClause, eq(pausedExecutions.status, statuses[0]))
      } else if (statuses.length > 1) {
        whereClause = and(whereClause, inArray(pausedExecutions.status, statuses as any))
      }
    }

    const rows = await db
      .select()
      .from(pausedExecutions)
      .where(whereClause)
      .orderBy(desc(pausedExecutions.pausedAt))

    return rows.map((row) => this.normalizePausedExecution(row, this.mapPausePoints(row.pausePoints)))
  }

  static async getPausedExecutionDetail(options: {
    workflowId: string
    executionId: string
  }): Promise<PausedExecutionDetail | null> {
    const { workflowId, executionId } = options

    const row = await db
      .select()
      .from(pausedExecutions)
      .where(
        and(eq(pausedExecutions.workflowId, workflowId), eq(pausedExecutions.executionId, executionId))
      )
      .limit(1)
      .then((rows) => rows[0])

    if (!row) {
      return null
    }

    const queueEntries = await db
      .select()
      .from(resumeQueue)
      .where(eq(resumeQueue.parentExecutionId, executionId))
      .orderBy(asc(resumeQueue.queuedAt))

    const normalizedQueue = queueEntries.map((entry) => this.normalizeQueueEntry(entry))
    const queuePositions = this.computeQueuePositions(normalizedQueue)
    const latestEntries = this.computeLatestEntriesByContext(normalizedQueue)

    const pausePoints = this.mapPausePoints(row.pausePoints, queuePositions, latestEntries)

    const executionSummary = this.normalizePausedExecution(row, pausePoints)

    return {
      ...executionSummary,
      executionSnapshot: row.executionSnapshot as SerializedSnapshot,
      queue: normalizedQueue,
    }
  }

  static async getPauseContextDetail(options: {
    workflowId: string
    executionId: string
    contextId: string
  }): Promise<PauseContextDetail | null> {
    const { workflowId, executionId, contextId } = options
    const detail = await this.getPausedExecutionDetail({ workflowId, executionId })

    if (!detail) {
      return null
    }

    const pausePoint = detail.pausePoints.find((point) => point.contextId === contextId)
    if (!pausePoint) {
      return null
    }

    const activeResumeEntry = detail.queue.find((entry) =>
      entry.contextId === contextId && (entry.status === 'claimed' || entry.status === 'pending')
    )

    return {
      execution: detail,
      pausePoint,
      queue: detail.queue,
      activeResumeEntry,
    }
  }

  static async processQueuedResumes(parentExecutionId: string): Promise<void> {
    const pendingEntry = await db.transaction(async (tx) => {
      const entry = await tx
        .select()
        .from(resumeQueue)
        .where(
          and(eq(resumeQueue.parentExecutionId, parentExecutionId), eq(resumeQueue.status, 'pending'))
        )
        .orderBy(asc(resumeQueue.queuedAt))
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

    const pausedMetadata = (pausedExecution.metadata as Record<string, any>) || {}

    this.startResumeExecution({
      resumeEntryId: entry.id,
      resumeExecutionId: entry.newExecutionId,
      pausedExecution,
      contextId: entry.contextId,
      resumeInput: entry.resumeInput,
      userId: pausedMetadata.executorUserId ?? '',
    }).catch((error) => {
      logger.error('Failed to start queued resume execution', {
        parentExecutionId,
        resumeEntryId: entry.id,
        error,
      })
    })
  }

  private static normalizeQueueEntry(entry: typeof resumeQueue.$inferSelect): ResumeQueueEntrySummary {
    return {
      id: entry.id,
      pausedExecutionId: entry.pausedExecutionId,
      parentExecutionId: entry.parentExecutionId,
      newExecutionId: entry.newExecutionId,
      contextId: entry.contextId,
      resumeInput: entry.resumeInput,
      status: entry.status,
      queuedAt: entry.queuedAt ? entry.queuedAt.toISOString() : null,
      claimedAt: entry.claimedAt ? entry.claimedAt.toISOString() : null,
      completedAt: entry.completedAt ? entry.completedAt.toISOString() : null,
      failureReason: entry.failureReason ?? null,
    }
  }

  private static normalizePausedExecution(
    row: typeof pausedExecutions.$inferSelect,
    pausePoints: PausePointWithQueue[]
  ): PausedExecutionSummary {
    return {
      id: row.id,
      workflowId: row.workflowId,
      executionId: row.executionId,
      status: row.status,
      totalPauseCount: row.totalPauseCount,
      resumedCount: row.resumedCount,
      pausedAt: row.pausedAt ? row.pausedAt.toISOString() : null,
      updatedAt: row.updatedAt ? row.updatedAt.toISOString() : null,
      expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
      metadata: row.metadata as Record<string, any>,
      triggerIds: (row.executionSnapshot as SerializedSnapshot)?.triggerIds || [],
      pausePoints,
    }
  }

  private static mapPausePoints(
    pausePoints: any,
    queuePositions?: Map<string, number | null>,
    latestEntries?: Map<string, ResumeQueueEntrySummary>
  ): PausePointWithQueue[] {
    const record = pausePoints as Record<string, any>
    if (!record) {
      return []
    }

    return Object.values(record).map((point: any) => {
      const queuePosition = queuePositions?.get(point.contextId ?? '') ?? null
      const latestEntry = latestEntries?.get(point.contextId ?? '')

      return {
        contextId: point.contextId,
        triggerBlockId: point.triggerBlockId,
        response: point.response,
        registeredAt: point.registeredAt,
        resumeStatus: point.resumeStatus || 'paused',
        snapshotReady: Boolean(point.snapshotReady),
        parallelScope: point.parallelScope,
        loopScope: point.loopScope,
        resumeLinks: point.resumeLinks,
        queuePosition,
        latestResumeEntry: latestEntry ?? null,
      }
    })
  }

  private static computeQueuePositions(
    queueEntries: ResumeQueueEntrySummary[]
  ): Map<string, number | null> {
    const pendingEntries = queueEntries
      .filter((entry) => entry.status === 'pending')
      .sort((a, b) => {
        const aTime = a.queuedAt ? Date.parse(a.queuedAt) : 0
        const bTime = b.queuedAt ? Date.parse(b.queuedAt) : 0
        return aTime - bTime
      })

    const positions = new Map<string, number | null>()
    pendingEntries.forEach((entry, index) => {
      if (!positions.has(entry.contextId)) {
        positions.set(entry.contextId, index + 1)
      }
    })

    return positions
  }

  private static computeLatestEntriesByContext(
    queueEntries: ResumeQueueEntrySummary[]
  ): Map<string, ResumeQueueEntrySummary> {
    const latestEntries = new Map<string, ResumeQueueEntrySummary>()

    queueEntries.forEach((entry) => {
      const existing = latestEntries.get(entry.contextId)
      if (!existing) {
        latestEntries.set(entry.contextId, entry)
        return
      }

      const existingTime = existing.queuedAt ? Date.parse(existing.queuedAt) : 0
      const currentTime = entry.queuedAt ? Date.parse(entry.queuedAt) : 0

      if (currentTime >= existingTime) {
        latestEntries.set(entry.contextId, entry)
      }
    })

    return latestEntries
  }
}

