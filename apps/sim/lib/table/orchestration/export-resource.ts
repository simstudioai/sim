import { db } from '@sim/db'
import { tableJobs } from '@sim/db/schema'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { and, eq } from 'drizzle-orm'
import type { V2TableExport, V2TableExportStatus } from '@/lib/api/contracts/v2/tables'
import { isTriggerDevEnabled } from '@/lib/core/config/env-flags'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { runDetached } from '@/lib/core/utils/background'
import { TABLE_LIMITS } from '@/lib/table/constants'
import { runTableExport, type TableExportPayload } from '@/lib/table/export-runner'
import { markJobCanceled, markJobFailed, markTableJobRunning } from '@/lib/table/jobs/service'
import type { TableDefinition, TableExportJobPayload } from '@/lib/table/types'

export type TableExportRecord = typeof tableJobs.$inferSelect

export async function createTableExportResource(params: {
  table: TableDefinition
  format: 'csv' | 'json'
}): Promise<TableExportRecord> {
  const exportId = generateId()
  const payload: TableExportJobPayload = { format: params.format }
  if (!(await markTableJobRunning(params.table.id, exportId, 'export', payload))) {
    throw new OrchestrationError('conflict', 'Failed to start export')
  }
  const runnerPayload: TableExportPayload = {
    jobId: exportId,
    tableId: params.table.id,
    workspaceId: params.table.workspaceId,
    format: params.format,
  }

  if (params.table.rowCount <= TABLE_LIMITS.EXPORT_ASYNC_THRESHOLD_ROWS) {
    await runTableExport(runnerPayload)
  } else {
    try {
      if (isTriggerDevEnabled) {
        const [{ tableExportTask }, { tasks }, { resolveTriggerRegion }] = await Promise.all([
          import('@/background/table-export'),
          import('@trigger.dev/sdk'),
          import('@/lib/core/async-jobs/region'),
        ])
        await tasks.trigger<typeof tableExportTask>('table-export', runnerPayload, {
          tags: [`tableId:${params.table.id}`, `jobId:${exportId}`],
          region: await resolveTriggerRegion(),
        })
      } else {
        runDetached('table-export', () => runTableExport(runnerPayload))
      }
    } catch (error) {
      await markJobFailed(
        params.table.id,
        exportId,
        getErrorMessage(error, 'Failed to dispatch table export')
      )
      throw error
    }
  }

  return requireTableExport(exportId, params.table.workspaceId)
}

export async function requireTableExport(
  exportId: string,
  workspaceId: string
): Promise<TableExportRecord> {
  const [record] = await db
    .select()
    .from(tableJobs)
    .where(
      and(
        eq(tableJobs.id, exportId),
        eq(tableJobs.workspaceId, workspaceId),
        eq(tableJobs.type, 'export')
      )
    )
    .limit(1)
  if (!record) throw new OrchestrationError('not_found', 'Table export not found')
  return record
}

export async function cancelTableExportResource(
  record: TableExportRecord
): Promise<TableExportRecord> {
  if (record.status === 'canceled') return record
  if (record.status !== 'running') {
    throw new OrchestrationError('conflict', `Table export is ${publicExportStatus(record.status)}`)
  }
  await markJobCanceled(record.tableId, record.id)
  return requireTableExport(record.id, record.workspaceId)
}

export function toV2TableExport(record: TableExportRecord, queued = false): V2TableExport {
  const payload = record.payload as TableExportJobPayload | null
  if (!payload?.format) throw new Error(`Table export ${record.id} has no format`)
  return {
    id: record.id,
    tableId: record.tableId,
    workspaceId: record.workspaceId,
    format: payload.format,
    status: queued && record.status === 'running' ? 'queued' : publicExportStatus(record.status),
    rowsProcessed: record.rowsProcessed,
    error: record.error,
    createdAt: record.startedAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    completedAt: record.completedAt?.toISOString() ?? null,
  }
}

export function tableExportResult(record: TableExportRecord): {
  resultKey: string
  format: 'csv' | 'json'
} {
  if (record.status !== 'ready') {
    throw new OrchestrationError('conflict', `Table export is ${publicExportStatus(record.status)}`)
  }
  const payload = record.payload as TableExportJobPayload | null
  if (!payload?.resultKey || !payload.format) {
    throw new OrchestrationError('not_found', 'Export file is no longer available')
  }
  return { resultKey: payload.resultKey, format: payload.format }
}

function publicExportStatus(status: string): V2TableExportStatus {
  if (status === 'running') return 'processing'
  if (status === 'ready') return 'completed'
  if (status === 'failed' || status === 'canceled') return status
  throw new Error(`Invalid table export status: ${status}`)
}
