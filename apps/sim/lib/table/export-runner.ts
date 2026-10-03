import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { neutralizeCsvFormula, toCsvRow } from '@/lib/core/utils/csv'
import { namedRowMapper } from '@/lib/table/cell-format'
import { getColumnId } from '@/lib/table/column-keys'
import { appendTableEvent } from '@/lib/table/events'
import { formatCsvCell, sanitizeExportFilename } from '@/lib/table/export-format'
import {
  markJobFailedInWorkspace,
  markJobReadyInWorkspace,
  selectExportRowPage,
  setJobResultKeyInWorkspace,
  updateJobProgressInWorkspace,
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
  let handle: MultipartUploadHandle | null = null
  let uploadedKey: string | null = null

  try {
    const table = await getTableById(tableId, { includeArchived: true })
    if (!table || table.workspaceId !== workspaceId) {
      throw new Error(`Export target table ${tableId} not found in workspace ${workspaceId}`)
    }

    const columns = table.schema.columns
    // Stored row data is id-keyed and select cells hold option ids; JSON keys are display
    // names and values are option names, so translate both on the way out (export is a
    // name-friendly boundary). Hoisted: the mapper is reused across every streamed page.
    const toNamedRow = namedRowMapper(columns)

    const fileName = `${sanitizeExportFilename(table.name)}.${format}`
    // The key is pinned up front so the streaming upload writes exactly where the download
    // route presigns; the *returned* key (from `complete`) is recorded as the source of truth.
    const key = `workspace/${workspaceId}/exports/${tableId}/${jobId}/${fileName}`
    const contentType = format === 'csv' ? 'text/csv; charset=utf-8' : 'application/json'

    // Stream the serialized file straight into storage in bounded parts instead of buffering the
    // whole thing in heap — a 1M-row export no longer holds hundreds of MB resident.
    handle = await createMultipartUpload({
      key,
      context: 'workspace',
      contentType,
      completionPolicy: 'replace',
    })
    await handle.write(
      format === 'csv' ? `${toCsvRow(columns.map((c) => neutralizeCsvFormula(c.name)))}\n` : '['
    )

    let exported = 0
    let firstJsonRow = true
    // `order_key` is nullable (rows predating the backfill), and the page query
    // seeks NULLs explicitly — so the cursor has to carry a null too.
    let after: { orderKey: string | null; id: string } | null = null
    while (true) {
      // Ownership gate before every page: a canceled job stops within one batch.
      const owns = await updateJobProgressInWorkspace(tableId, workspaceId, exported, jobId)
      if (!owns) throw new JobSupersededError()

      const page = await selectExportRowPage(table, after, EXPORT_BATCH_SIZE)
      if (page.length === 0) break

      const pageChunks: string[] = []
      for (const row of page) {
        if (format === 'csv') {
          pageChunks.push(
            `${toCsvRow(columns.map((c) => formatCsvCell(c, row.data[getColumnId(c)])))}\n`
          )
        } else {
          const prefix = firstJsonRow ? '' : ','
          firstJsonRow = false
          pageChunks.push(prefix + JSON.stringify(toNamedRow(row.data)))
        }
      }
      await handle.write(pageChunks.join(''))

      exported += page.length
      const last = page[page.length - 1]
      after = { orderKey: last.orderKey, id: last.id }
      if (page.length < EXPORT_BATCH_SIZE) break
    }
    if (format === 'json') await handle.write(']')

    const ownsFinalize = await updateJobProgressInWorkspace(tableId, workspaceId, exported, jobId)
    if (!ownsFinalize) throw new JobSupersededError()

    const uploaded = await handle.complete()
    uploadedKey = uploaded.key
    const storedResult = await setJobResultKeyInWorkspace(tableId, workspaceId, jobId, uploaded.key)
    if (!storedResult) throw new JobSupersededError()

    const ownsReadyTransition = await updateJobProgressInWorkspace(
      tableId,
      workspaceId,
      exported,
      jobId
    )
    if (!ownsReadyTransition) throw new JobSupersededError()
    // Only announce success if we still won the transition (not canceled at the wire).
    const becameReady = await markJobReadyInWorkspace(tableId, workspaceId, jobId)
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
      try {
        await deleteFile({ key: uploaded.key, context: 'workspace' })
      } catch (cleanupError) {
        logger.warn(`[${requestId}] Failed to delete superseded export`, {
          tableId,
          workspaceId,
          jobId,
          key: uploaded.key,
          error: getErrorMessage(cleanupError, 'Unknown cleanup error'),
        })
      }
      logger.info(`[${requestId}] Export finished but no longer owns the run`, { tableId, jobId })
    }
  } catch (err) {
    // A partial/orphaned upload from this attempt is useless — clean it up best-effort. An
    // in-flight multipart upload (not yet completed) is aborted so no staged parts linger; a
    // completed-but-unannounced upload is removed by key.
    if (uploadedKey) {
      try {
        await deleteFile({ key: uploadedKey, context: 'workspace' })
      } catch (cleanupError) {
        logger.warn(`[${requestId}] Failed to delete incomplete export`, {
          tableId,
          workspaceId,
          jobId,
          key: uploadedKey,
          error: getErrorMessage(cleanupError, 'Unknown cleanup error'),
        })
      }
    } else if (handle) {
      try {
        await handle.abort()
      } catch (cleanupError) {
        logger.warn(`[${requestId}] Failed to abort incomplete export`, {
          tableId,
          workspaceId,
          jobId,
          error: getErrorMessage(cleanupError, 'Unknown cleanup error'),
        })
      }
    }
    if (err instanceof JobSupersededError) {
      logger.info(`[${requestId}] Export superseded/canceled; stopping`, { tableId, jobId })
    } else {
      const message = getErrorMessage(err, 'Export failed')
      logger.error(`[${requestId}] Export failed for table ${tableId}:`, err)
      try {
        await markJobFailedInWorkspace(tableId, workspaceId, jobId, message)
      } catch (failureError) {
        logger.error(`[${requestId}] Failed to mark export job failed`, {
          tableId,
          workspaceId,
          jobId,
          error: getErrorMessage(failureError, 'Unknown job transition error'),
        })
      }
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
