import { db } from '@sim/db'
import {
  workflowExecutionLogs,
  workspaceFileWorkflowBudget,
  workspaceFileWorkflowInputRun,
} from '@sim/db/schema'
import { and, eq, lt, ne, or, sql } from 'drizzle-orm'
import { getRedisClient } from '@/lib/core/config/redis'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  FILE_WORKFLOW_INTERVAL_MS,
  FILE_WORKFLOW_MAX_RUNS_PER_WINDOW,
  FILE_WORKFLOW_RESULT_MAX_BYTES,
  FILE_WORKFLOW_RESULT_TTL_SECONDS,
  type FileWorkflowSnapshot,
  fileWorkflowSnapshotSchema,
} from '@/lib/workspace-files/workflows/types'

export type FileWorkflowRun = typeof workspaceFileWorkflowInputRun.$inferSelect
export interface FileWorkflowRunKey {
  fileId: string
  workflowId: string
  audience: string
  inputHash: string
}

class FileWorkflowAdmissionRace extends Error {}

function resultRedis() {
  const redis = getRedisClient()
  if (!redis) throw new Error('HTML workflow results require Redis')
  return redis
}

async function loadFileWorkflowRun(key: FileWorkflowRunKey): Promise<FileWorkflowRun | null> {
  const [run] = await db
    .select()
    .from(workspaceFileWorkflowInputRun)
    .where(
      and(
        eq(workspaceFileWorkflowInputRun.fileId, key.fileId),
        eq(workspaceFileWorkflowInputRun.workflowId, key.workflowId),
        eq(workspaceFileWorkflowInputRun.audience, key.audience),
        eq(workspaceFileWorkflowInputRun.inputHash, key.inputHash)
      )
    )
    .limit(1)
  return run ?? null
}

/** A resumed workflow may finish outside the original HTTP request. This projection never writes. */
export async function readFileWorkflowRun(
  key: FileWorkflowRunKey
): Promise<FileWorkflowRun | null> {
  const run = await loadFileWorkflowRun(key)
  if (!run || run.status !== 'running') return run
  const [log] = await db
    .select({ status: workflowExecutionLogs.status, endedAt: workflowExecutionLogs.endedAt })
    .from(workflowExecutionLogs)
    .where(eq(workflowExecutionLogs.executionId, run.executionId))
    .limit(1)
  if (!log || !['completed', 'failed', 'cancelled'].includes(log.status)) return run
  return {
    ...run,
    status: log.status === 'completed' ? 'completed' : 'failed',
    finishedAt: log.endedAt,
  }
}

/** Only execution requests reconcile terminal logs; status reads remain side-effect free. */
export async function reconcileFileWorkflowRun(key: FileWorkflowRunKey): Promise<void> {
  const run = await loadFileWorkflowRun(key)
  if (!run) return
  /** A paused run can finish via the normal resume path. Never guess that a missing log means stopped. */
  if (run.status === 'running') {
    const [log] = await db
      .select({ status: workflowExecutionLogs.status })
      .from(workflowExecutionLogs)
      .where(eq(workflowExecutionLogs.executionId, run.executionId))
      .limit(1)
    if (log && ['completed', 'failed', 'cancelled'].includes(log.status)) {
      /** The synchronous owner may still be publishing its output; only reconcile old admissions. */
      if (Date.now() - run.startedAt.getTime() > FILE_WORKFLOW_INTERVAL_MS) {
        await db
          .update(workspaceFileWorkflowInputRun)
          .set({ status: 'failed', finishedAt: new Date() })
          .where(
            and(
              eq(workspaceFileWorkflowInputRun.fileId, key.fileId),
              eq(workspaceFileWorkflowInputRun.workflowId, key.workflowId),
              eq(workspaceFileWorkflowInputRun.audience, key.audience),
              eq(workspaceFileWorkflowInputRun.inputHash, key.inputHash),
              eq(workspaceFileWorkflowInputRun.executionId, run.executionId),
              eq(workspaceFileWorkflowInputRun.status, 'running')
            )
          )
          .returning()
        return
      }
    }
  }
}

/** Per-input cooldown and the overall file budget commit or roll back together. */
export async function claimFileWorkflowRun(
  args: FileWorkflowRunKey & {
    executionId: string
    deploymentVersionId: string
  }
): Promise<FileWorkflowRun | null> {
  try {
    return await db.transaction(async (tx) => {
      await tx
        .delete(workspaceFileWorkflowInputRun)
        .where(
          and(
            eq(workspaceFileWorkflowInputRun.fileId, args.fileId),
            eq(workspaceFileWorkflowInputRun.workflowId, args.workflowId),
            ne(workspaceFileWorkflowInputRun.status, 'running'),
            lt(workspaceFileWorkflowInputRun.startedAt, sql`now() - interval '10 minutes'`)
          )
        )
      const [budget] = await tx
        .insert(workspaceFileWorkflowBudget)
        .values({ fileId: args.fileId, workflowId: args.workflowId, count: 1 })
        .onConflictDoUpdate({
          target: [workspaceFileWorkflowBudget.fileId, workspaceFileWorkflowBudget.workflowId],
          set: {
            count: sql`CASE WHEN ${workspaceFileWorkflowBudget.windowStartedAt} <= now() - interval '300 seconds' THEN 1 ELSE ${workspaceFileWorkflowBudget.count} + 1 END`,
            windowStartedAt: sql`CASE WHEN ${workspaceFileWorkflowBudget.windowStartedAt} <= now() - interval '300 seconds' THEN now() ELSE ${workspaceFileWorkflowBudget.windowStartedAt} END`,
          },
          setWhere: or(
            sql`${workspaceFileWorkflowBudget.windowStartedAt} <= now() - interval '300 seconds'`,
            lt(workspaceFileWorkflowBudget.count, FILE_WORKFLOW_MAX_RUNS_PER_WINDOW)
          ),
        })
        .returning()
      if (!budget)
        throw new OrchestrationError(
          'conflict',
          'This file has reached its workflow run limit; try again later'
        )
      const [row] = await tx
        .insert(workspaceFileWorkflowInputRun)
        .values({ ...args, status: 'running' })
        .onConflictDoUpdate({
          target: [
            workspaceFileWorkflowInputRun.fileId,
            workspaceFileWorkflowInputRun.workflowId,
            workspaceFileWorkflowInputRun.audience,
            workspaceFileWorkflowInputRun.inputHash,
          ],
          set: {
            executionId: args.executionId,
            deploymentVersionId: args.deploymentVersionId,
            startedAt: sql`now()`,
            finishedAt: null,
            status: 'running',
          },
          setWhere: and(
            ne(workspaceFileWorkflowInputRun.status, 'running'),
            or(
              sql`${workspaceFileWorkflowInputRun.startedAt} <= now() - interval '300 seconds'`,
              ne(workspaceFileWorkflowInputRun.deploymentVersionId, args.deploymentVersionId)
            )
          ),
        })
        .returning()
      if (!row) throw new FileWorkflowAdmissionRace()
      return row
    })
  } catch (error) {
    if (error instanceof FileWorkflowAdmissionRace) return null
    throw error
  }
}

export async function finishFileWorkflowRun(
  run: FileWorkflowRun,
  result: FileWorkflowSnapshot
): Promise<void> {
  await db
    .update(workspaceFileWorkflowInputRun)
    .set({
      status:
        result.status === 'completed'
          ? 'completed'
          : result.status === 'running'
            ? 'running'
            : 'failed',
      deploymentVersionId: result.deploymentVersionId ?? run.deploymentVersionId,
      finishedAt: result.status === 'running' ? null : new Date(),
    })
    .where(
      and(
        eq(workspaceFileWorkflowInputRun.fileId, run.fileId),
        eq(workspaceFileWorkflowInputRun.workflowId, run.workflowId),
        eq(workspaceFileWorkflowInputRun.audience, run.audience),
        eq(workspaceFileWorkflowInputRun.inputHash, run.inputHash),
        eq(workspaceFileWorkflowInputRun.executionId, run.executionId)
      )
    )
}

function resultKey(audience: string, executionId: string) {
  return `file-workflow:v1:${audience}:${executionId}`
}

export async function readFileWorkflowResult(
  audience: string,
  executionId: string
): Promise<FileWorkflowSnapshot | null> {
  const value = await resultRedis().get(resultKey(audience, executionId))
  return value === null ? null : fileWorkflowSnapshotSchema.parse(JSON.parse(value))
}

/** Cache one bounded result for each admitted execution and audience. */
export async function cacheFileWorkflowResult(
  audience: string,
  result: FileWorkflowSnapshot
): Promise<void> {
  const serialized = JSON.stringify(result)
  if (Buffer.byteLength(serialized) > FILE_WORKFLOW_RESULT_MAX_BYTES)
    throw new OrchestrationError(
      'payload_too_large',
      'Workflow result exceeds the 1 MB HTML result limit'
    )
  if (!result.executionId) throw new Error('Cannot cache a workflow result without an execution ID')
  await resultRedis().set(
    resultKey(audience, result.executionId),
    serialized,
    'EX',
    FILE_WORKFLOW_RESULT_TTL_SECONDS
  )
}

export async function assertFileWorkflowCacheAvailable() {
  await resultRedis().ping()
}
