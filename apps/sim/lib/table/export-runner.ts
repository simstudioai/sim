import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { captureServerEvent } from '@/lib/posthog/server'
import { buildNameById, getColumnId, rowDataIdToName } from '@/lib/table/column-keys'
import { appendTableEvent } from '@/lib/table/events'
import {
  formatCsvValue,
  neutralizeCsvFormula,
  sanitizeExportFilename,
  toCsvRow,
} from '@/lib/table/export-format'
import {
  markJobFailed,
  markJobReady,
  selectExportRowPage,
  setJobResultKey,
  updateJobProgress,
} from '@/lib/table/jobs/service'
import { getTableById } from '@/lib/table/service'
import {
  createMultipartUpload,
  deleteFile,
  type MultipartUploadHandle,
} from '@/lib/uploads/core/storage-service'

const logger = createLogger('TableExportRunner')

/** Rows per page while building the file. Internal caller — not bound by MAX_QUERY_LIMIT; rows
 *  are fetched without executions, so even wide rows stay a few MB per batch. */
const EXPORT_BATCH_SIZE = 5000

/** Thrown when this worker loses the job (canceled / janitor-failed). */
class JobSupersededError extends Error {}

export interface TableExportPayload {
  jobId: string
  tableId: string
  workspaceId: string
  format: 'csv' | 'json'
  /** The user who requested the export; attributes the audit/analytics record. */
  userId?: string
}

/**
 * Background worker for large table exports. Pages rows via `queryRows` (so the delete-job
 * visibility mask applies — an export taken mid-delete excludes the doomed rows), accumulates the
 * serialized file, uploads it to workspace storage, and stamps the storage key onto the job's
 * payload (`resultKey`). The client downloads via a presigned URL from the download route; the
 * janitor deletes the file when the terminal job is pruned. Ownership-gated per batch, so a
 * cancel stops it within one page. Retry-safe: a retried attempt regenerates the file from
 * scratch and overwrites nothing (fresh key per attempt; failures clean up their partial upload).
 */
export async function runTableExport(payload: TableExportPayload): Promise<void> {
  const { jobId, tableId, workspaceId, format, userId } = payload
  const requestId = generateId().slice(0, 8)
  let handle: MultipartUploadHandle | null = null
  let uploadedKey: string | null = null

  try {
    const table = await getTableById(tableId, { includeArchived: true })
    if (!table) throw new Error(`Export target table ${tableId} not found`)

    const columns = table.schema.columns
    // Stored row data is id-keyed; CSV headers and JSON keys are display names, so translate
    // id → name on the way out (export is a name-friendly boundary).
    const nameById = buildNameById(table.schema)

    const fileName = `${sanitizeExportFilename(table.name)}.${format}`
    // The key is pinned up front so the streaming upload writes exactly where the download
    // route presigns; the *returned* key (from `complete`) is recorded as the source of truth.
    const key = `workspace/${workspaceId}/exports/${tableId}/${jobId}/${fileName}`
    const contentType = format === 'csv' ? 'text/csv; charset=utf-8' : 'application/json'

    // Stream the serialized file straight into storage in bounded parts instead of buffering the
    // whole thing in heap — a 1M-row export no longer holds hundreds of MB resident.
    handle = await createMultipartUpload({ key, context: 'workspace', contentType })
    await handle.write(
      format === 'csv' ? `${toCsvRow(columns.map((c) => neutralizeCsvFormula(c.name)))}\n` : '['
    )

    let exported = 0
    let firstJsonRow = true
    let after: { orderKey: string; id: string } | null = null
    while (true) {
      // Ownership gate before every page: a canceled job stops within one batch.
      const owns = await updateJobProgress(tableId, exported, jobId)
      if (!owns) throw new JobSupersededError()

      const page = await selectExportRowPage(table, after, EXPORT_BATCH_SIZE)
      if (page.length === 0) break

      const pageChunks: string[] = []
      for (const row of page) {
        if (format === 'csv') {
          pageChunks.push(
            `${toCsvRow(columns.map((c) => formatCsvValue(row.data[getColumnId(c)])))}\n`
          )
        } else {
          const prefix = firstJsonRow ? '' : ','
          firstJsonRow = false
          pageChunks.push(prefix + JSON.stringify(rowDataIdToName(row.data, nameById)))
        }
      }
      await handle.write(pageChunks.join(''))

      exported += page.length
      const last = page[page.length - 1]
      after = { orderKey: last.orderKey, id: last.id }
      if (page.length < EXPORT_BATCH_SIZE) break
    }
    if (format === 'json') await handle.write(']')

    const ownsFinalize = await updateJobProgress(tableId, exported, jobId)
    if (!ownsFinalize) throw new JobSupersededError()

    const uploaded = await handle.complete()
    uploadedKey = uploaded.key
    await setJobResultKey(tableId, jobId, uploaded.key)

    await updateJobProgress(tableId, exported, jobId)
    // Only announce success if we still won the transition (not canceled at the wire).
    const becameReady = await markJobReady(tableId, jobId)
    if (becameReady) {
      void appendTableEvent({
        kind: 'job',
        type: 'export',
        tableId,
        jobId,
        status: 'ready',
        progress: exported,
      })
      logger.info(`[${requestId}] Export complete`, { tableId, rows: exported, format })

      const actorId = userId ?? table.createdBy
      if (actorId) {
        recordAudit({
          workspaceId,
          actorId,
          action: AuditAction.TABLE_EXPORTED,
          resourceType: AuditResourceType.TABLE,
          resourceId: tableId,
          resourceName: table.name,
          description: `Exported table "${table.name}" as ${format.toUpperCase()}`,
          metadata: { format, rowCount: exported, async: true },
        })
        captureServerEvent(
          actorId,
          'table_exported',
          { table_id: tableId, workspace_id: workspaceId },
          { groups: { workspace: workspaceId } }
        )
      }
    } else {
      // Canceled at the very end — the file is orphaned; remove it (janitor would otherwise
      // only catch it via the pruned job's resultKey).
      await deleteFile({ key: uploaded.key, context: 'workspace' }).catch(() => {})
      logger.info(`[${requestId}] Export finished but no longer owns the run`, { tableId, jobId })
    }
  } catch (err) {
    // A partial/orphaned upload from this attempt is useless — clean it up best-effort. An
    // in-flight multipart upload (not yet completed) is aborted so no staged parts linger; a
    // completed-but-unannounced upload is removed by key.
    if (uploadedKey) {
      await deleteFile({ key: uploadedKey, context: 'workspace' }).catch(() => {})
    } else if (handle) {
      await handle.abort().catch(() => {})
    }
    if (err instanceof JobSupersededError) {
      logger.info(`[${requestId}] Export superseded/canceled; stopping`, { tableId, jobId })
    } else {
      const message = getErrorMessage(err, 'Export failed')
      logger.error(`[${requestId}] Export failed for table ${tableId}:`, err)
      await markJobFailed(tableId, jobId, message).catch(() => {})
      void appendTableEvent({
        kind: 'job',
        type: 'export',
        tableId,
        jobId,
        status: 'failed',
        error: message,
      })
    }
  }
}
