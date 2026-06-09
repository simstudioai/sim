import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { buildNameById, getColumnId, rowDataIdToName } from '@/lib/table/column-keys'
import { appendTableEvent } from '@/lib/table/events'
import {
  formatCsvValue,
  neutralizeCsvFormula,
  sanitizeExportFilename,
  toCsvRow,
} from '@/lib/table/export-format'
import {
  getTableById,
  markJobFailed,
  markJobReady,
  queryRows,
  setJobResultKey,
  updateJobProgress,
} from '@/lib/table/service'
import { deleteFile, uploadFile } from '@/lib/uploads/core/storage-service'

const logger = createLogger('TableExportRunner')

const EXPORT_BATCH_SIZE = 1000

/** Thrown when this worker loses the job (canceled / janitor-failed). */
class JobSupersededError extends Error {}

export interface TableExportPayload {
  jobId: string
  tableId: string
  workspaceId: string
  format: 'csv' | 'json'
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
  const { jobId, tableId, workspaceId, format } = payload
  const requestId = generateId().slice(0, 8)
  let uploadedKey: string | null = null

  try {
    const table = await getTableById(tableId, { includeArchived: true })
    if (!table) throw new Error(`Export target table ${tableId} not found`)

    const columns = table.schema.columns
    // Stored row data is id-keyed; CSV headers and JSON keys are display names, so translate
    // id → name on the way out (export is a name-friendly boundary).
    const nameById = buildNameById(table.schema)

    const chunks: string[] = []
    if (format === 'csv') {
      chunks.push(`${toCsvRow(columns.map((c) => neutralizeCsvFormula(c.name)))}\n`)
    } else {
      chunks.push('[')
    }

    let offset = 0
    let exported = 0
    let firstJsonRow = true
    while (true) {
      // Ownership gate before every page: a canceled job stops within one batch.
      const owns = await updateJobProgress(tableId, exported, jobId)
      if (!owns) throw new JobSupersededError()

      const result = await queryRows(
        table,
        { limit: EXPORT_BATCH_SIZE, offset, includeTotal: false, withExecutions: false },
        requestId
      )

      for (const row of result.rows) {
        if (format === 'csv') {
          chunks.push(`${toCsvRow(columns.map((c) => formatCsvValue(row.data[getColumnId(c)])))}\n`)
        } else {
          const prefix = firstJsonRow ? '' : ','
          firstJsonRow = false
          chunks.push(prefix + JSON.stringify(rowDataIdToName(row.data, nameById)))
        }
      }

      exported += result.rows.length
      if (result.rows.length < EXPORT_BATCH_SIZE) break
      offset += result.rows.length
    }
    if (format === 'json') chunks.push(']')

    const fileName = `${sanitizeExportFilename(table.name)}.${format}`
    const key = `workspace/${workspaceId}/exports/${tableId}/${jobId}/${fileName}`
    await uploadFile({
      file: Buffer.from(chunks.join(''), 'utf8'),
      fileName,
      contentType: format === 'csv' ? 'text/csv; charset=utf-8' : 'application/json',
      context: 'workspace',
      customKey: key,
    })
    uploadedKey = key
    await setJobResultKey(tableId, jobId, key)

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
    } else {
      // Canceled at the very end — the file is orphaned; remove it (janitor would otherwise
      // only catch it via the pruned job's resultKey).
      await deleteFile({ key, context: 'workspace' }).catch(() => {})
      logger.info(`[${requestId}] Export finished but no longer owns the run`, { tableId, jobId })
    }
  } catch (err) {
    // A partial/orphaned upload from this attempt is useless — clean it up best-effort.
    if (uploadedKey) await deleteFile({ key: uploadedKey, context: 'workspace' }).catch(() => {})
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
