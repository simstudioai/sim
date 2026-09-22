import { db } from '@sim/db'
import { workflowExecutionLogs, workspaceFileWorkflowRun } from '@sim/db/schema'
import { and, eq, ne, sql } from 'drizzle-orm'
import { getRedisClient } from '@/lib/core/config/redis'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  FILE_WORKFLOW_INTERVAL_MS,
  FILE_WORKFLOW_RESULT_MAX_BYTES,
  FILE_WORKFLOW_RESULT_TTL_SECONDS,
  type FileWorkflowSnapshot,
  fileWorkflowSnapshotSchema,
} from '@/lib/workspace-files/workflows/types'

export type FileWorkflowRun = typeof workspaceFileWorkflowRun.$inferSelect

function resultRedis() {
  const redis = getRedisClient()
  if (!redis) throw new Error('HTML workflow results require Redis')
  return redis
}

async function loadFileWorkflowRun(
  fileId: string,
  workflowId: string
): Promise<FileWorkflowRun | null> {
  const [run] = await db
    .select()
    .from(workspaceFileWorkflowRun)
    .where(
      and(
        eq(workspaceFileWorkflowRun.fileId, fileId),
        eq(workspaceFileWorkflowRun.workflowId, workflowId)
      )
    )
    .limit(1)
  return run ?? null
}

/** A resumed workflow may finish outside the original HTTP request. This projection never writes. */
export async function readFileWorkflowRun(
  fileId: string,
  workflowId: string
): Promise<FileWorkflowRun | null> {
  const run = await loadFileWorkflowRun(fileId, workflowId)
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
export async function reconcileFileWorkflowRun(fileId: string, workflowId: string): Promise<void> {
  const run = await loadFileWorkflowRun(fileId, workflowId)
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
          .update(workspaceFileWorkflowRun)
          .set({ status: 'failed', finishedAt: new Date() })
          .where(
            and(
              eq(workspaceFileWorkflowRun.fileId, fileId),
              eq(workspaceFileWorkflowRun.workflowId, workflowId),
              eq(workspaceFileWorkflowRun.executionId, run.executionId),
              eq(workspaceFileWorkflowRun.status, 'running')
            )
          )
          .returning()
        return
      }
    }
  }
}

/** One atomic upsert enforces both the durable cooldown and one admitted run per file/workflow. */
export async function claimFileWorkflowRun(args: {
  fileId: string
  workflowId: string
  executionId: string
  audience: string
}): Promise<FileWorkflowRun | null> {
  const [row] = await db
    .insert(workspaceFileWorkflowRun)
    .values({ ...args, status: 'running' })
    .onConflictDoUpdate({
      target: [workspaceFileWorkflowRun.fileId, workspaceFileWorkflowRun.workflowId],
      set: {
        executionId: args.executionId,
        audience: args.audience,
        startedAt: sql`now()`,
        finishedAt: null,
        deploymentVersionId: null,
        status: 'running',
      },
      setWhere: and(
        ne(workspaceFileWorkflowRun.status, 'running'),
        sql`${workspaceFileWorkflowRun.startedAt} <= now() - interval '300 seconds'`
      ),
    })
    .returning()
  return row ?? null
}

export async function finishFileWorkflowRun(
  run: FileWorkflowRun,
  result: FileWorkflowSnapshot
): Promise<void> {
  await db
    .update(workspaceFileWorkflowRun)
    .set({
      status:
        result.status === 'completed'
          ? 'completed'
          : result.status === 'running'
            ? 'running'
            : 'failed',
      deploymentVersionId: result.deploymentVersionId,
      finishedAt: result.status === 'running' ? null : new Date(),
    })
    .where(
      and(
        eq(workspaceFileWorkflowRun.fileId, run.fileId),
        eq(workspaceFileWorkflowRun.workflowId, run.workflowId),
        eq(workspaceFileWorkflowRun.executionId, run.executionId)
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

/** A file/workflow admits at most one bounded result per five minutes, across all audiences. */
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
