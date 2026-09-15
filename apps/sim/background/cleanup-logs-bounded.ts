import {
  executionLargeValues,
  jobExecutionLogs,
  pausedExecutions,
  workflowExecutionLogs,
  workflowExecutionSnapshots,
  workspaceFiles,
} from '@sim/db/schema'
import { chunkArray } from '@sim/utils/helpers'
import { and, asc, eq, inArray, isNull, lt, notInArray, sql } from 'drizzle-orm'
import type { CleanupJobPayload } from '@/lib/billing/cleanup-dispatcher'
import type { BoundedCleanup } from '@/lib/cleanup/bounded'
import { boundedDelete } from '@/lib/cleanup/bounded-delete'
import { pruneBoundedLargeValueMetadata } from '@/lib/cleanup/bounded-large-value-metadata'
import { deleteBoundedStorage, tombstoneBoundedFiles } from '@/lib/cleanup/bounded-storage'
import {
  LIVE_PAUSED_REFERENCE_STATUSES,
  unreferencedLargeValuePredicate,
} from '@/lib/execution/payloads/large-value-metadata'
import { isUsingCloudStorage } from '@/lib/uploads'
import { legacyLargeValuePredicate } from '@/background/cleanup-logs'

/** Retention guards and mandatory storage effects match the scheduled log cleanup. */
export async function runBoundedLogScope(payload: CleanupJobPayload, control: BoundedCleanup) {
  const cutoff = new Date(Date.now() - payload.retentionHours * 3600_000)
  for (const ids of chunkArray(payload.workspaceIds, 50)) {
    const logsEligible = and(
      inArray(workflowExecutionLogs.workspaceId, ids),
      lt(workflowExecutionLogs.startedAt, cutoff),
      sql`NOT EXISTS (SELECT 1 FROM ${pausedExecutions} pe WHERE pe.execution_id = ${workflowExecutionLogs.executionId} AND pe.status IN ${LIVE_PAUSED_REFERENCE_STATUSES})`
    )
    await control.batches(
      'workflowLogs',
      (limit, seen) =>
        control.query(async (tx) =>
          tx
            .select({ id: workflowExecutionLogs.id, files: workflowExecutionLogs.files })
            .from(workflowExecutionLogs)
            .where(
              and(
                logsEligible,
                seen.length ? notInArray(workflowExecutionLogs.id, seen) : undefined
              )
            )
            .orderBy(
              asc(workflowExecutionLogs.workspaceId),
              asc(workflowExecutionLogs.startedAt),
              asc(workflowExecutionLogs.id)
            )
            .limit(limit)
        ),
      (row) => row.id,
      async (rows) => {
        const deleted = await control.query(async (tx) =>
          tx
            .delete(workflowExecutionLogs)
            .where(
              and(
                logsEligible,
                inArray(
                  workflowExecutionLogs.id,
                  rows.map((row) => row.id)
                )
              )
            )
            .returning({ id: workflowExecutionLogs.id, files: workflowExecutionLogs.files })
        )
        await control.deleted('workflowLogs', deleted.length)
        for (const row of deleted) {
          const keys = Array.isArray(row.files)
            ? row.files.flatMap((file) =>
                file && typeof file === 'object' && 'key' in file && typeof file.key === 'string'
                  ? [file.key]
                  : []
              )
            : []
          await deleteBoundedStorage(control, 'workflowLogs', keys, 'execution')
          if (isUsingCloudStorage()) await tombstoneBoundedFiles(control, keys)
        }
      }
    )
    await boundedDelete(
      control,
      'jobLogs',
      jobExecutionLogs,
      jobExecutionLogs.id,
      and(inArray(jobExecutionLogs.workspaceId, ids), lt(jobExecutionLogs.startedAt, cutoff))
    )

    for (const legacy of [false, true]) {
      const type = legacy ? 'legacyLargeValues' : 'largeValues'
      const table = legacy ? workspaceFiles : executionLargeValues
      const eligible = legacy
        ? and(
            inArray(workspaceFiles.workspaceId, ids),
            eq(workspaceFiles.context, 'execution'),
            isNull(workspaceFiles.deletedAt),
            lt(workspaceFiles.uploadedAt, new Date(cutoff.getTime() - 30 * 86400_000)),
            legacyLargeValuePredicate()
          )
        : and(
            inArray(executionLargeValues.workspaceId, ids),
            isNull(executionLargeValues.deletedAt),
            lt(executionLargeValues.createdAt, new Date(cutoff.getTime() - 7 * 86400_000)),
            unreferencedLargeValuePredicate()
          )
      await control.batches(
        type,
        (limit, seen) =>
          control.query(async (tx) =>
            tx
              .select({ key: table.key })
              .from(table)
              .where(and(eligible, seen.length ? notInArray(table.key, seen) : undefined))
              .orderBy(
                asc(table.workspaceId),
                asc(legacy ? workspaceFiles.uploadedAt : executionLargeValues.createdAt),
                asc(table.key)
              )
              .limit(limit)
          ),
        (row) => row.key,
        async (rows) => {
          if (!isUsingCloudStorage()) return
          const selectedKeys = rows.map((row) => row.key)
          const keys = await control.query(async (tx) => {
            await tx
              .select({ key: table.key })
              .from(table)
              .where(inArray(table.key, selectedKeys))
              .orderBy(asc(table.key))
              .for('update')
            const claimed = await tx
              .update(table)
              .set({ deletedAt: new Date() })
              .where(and(eligible, inArray(table.key, selectedKeys)))
              .returning({ key: table.key })
            return claimed.map((row) => row.key)
          })
          await deleteBoundedStorage(control, type, keys, 'execution')
          await control.deleted(type, keys.length)
          await tombstoneBoundedFiles(control, keys)
        }
      )
    }

    await pruneBoundedLargeValueMetadata(control, ids)
    if (control.stopped()) return
  }
  if (payload.runGlobalHousekeeping && payload.plan === 'free') {
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - (Math.floor(payload.retentionHours / 24) + 1))
    await boundedDelete(
      control,
      'orphanSnapshots',
      workflowExecutionSnapshots,
      workflowExecutionSnapshots.id,
      and(
        lt(workflowExecutionSnapshots.createdAt, cutoff),
        sql`NOT EXISTS (SELECT 1 FROM ${workflowExecutionLogs} wel WHERE wel.state_snapshot_id = ${workflowExecutionSnapshots.id})`
      )
    )
  }
}
