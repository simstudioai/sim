import { task } from '@trigger.dev/sdk'
import { runTableExport, type TableExportPayload } from '@/lib/table/export-runner'

/**
 * Trigger.dev wrapper around `runTableExport`. Retry-safe: a retried attempt regenerates the file
 * from scratch (failures abort/clean up their partial upload), and the `table_jobs` ownership gate
 * stops a run that lost the job. The file streams to storage in bounded multipart chunks (no longer
 * buffered whole), so `medium-1x` is now headroom rather than a hard requirement.
 */
export const tableExportTask = task({
  id: 'table-export',
  machine: 'medium-1x',
  retry: { maxAttempts: 3 },
  queue: {
    name: 'table-export',
    concurrencyLimit: 10,
  },
  run: async (payload: TableExportPayload) => {
    await runTableExport(payload)
  },
})
